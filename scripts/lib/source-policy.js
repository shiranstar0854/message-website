const STATUS_ORDER = ["active", "reduced", "limited", "paused"];

function ratio(part, total) {
  return total > 0 ? Number((part / total).toFixed(4)) : 0;
}

function summarizeRuns(runs) {
  const totals = runs.reduce((sum, run) => ({
    fetched: sum.fetched + Number(run.fetchedCount || 0),
    passed: sum.passed + Number(run.passedCount || 0),
    duplicates: sum.duplicates + Number(run.duplicateCount || 0),
    highValue: sum.highValue + Number(run.highValueCount || 0),
    bodyAttempts: sum.bodyAttempts + Number(run.bodyAttemptCount || 0),
    bodySuccess: sum.bodySuccess + Number(run.bodySuccessCount || 0),
    densityTotal: sum.densityTotal + Number(run.densityTotal || 0),
    densityCount: sum.densityCount + Number(run.densityCount || 0)
  }), { fetched: 0, passed: 0, duplicates: 0, highValue: 0, bodyAttempts: 0, bodySuccess: 0, densityTotal: 0, densityCount: 0 });
  return {
    runCount: runs.length,
    metadataCount: totals.fetched,
    fetchedCount: totals.fetched,
    passRate: ratio(totals.passed, totals.fetched),
    duplicateRate: ratio(totals.duplicates, totals.fetched),
    highValueRate: ratio(totals.highValue, totals.fetched),
    bodySuccessRate: totals.bodyAttempts ? ratio(totals.bodySuccess, totals.bodyAttempts) : null,
    averageInformationDensity: totals.densityCount ? Number((totals.densityTotal / totals.densityCount).toFixed(2)) : 0
  };
}

function windowRuns(runs, days, now = new Date()) {
  const cutoff = now.getTime() - days * 86400000;
  return runs.filter((run) => new Date(run.generatedAt || 0).getTime() >= cutoff);
}

function metricsForWindows(runs, now = new Date()) {
  return {
    days7: summarizeRuns(windowRuns(runs, 7, now)),
    days14: summarizeRuns(windowRuns(runs, 14, now)),
    days30: summarizeRuns(windowRuns(runs, 30, now))
  };
}

function nextStatus(current, windows, history, now = new Date()) {
  const status = STATUS_ORDER.includes(current.status) ? current.status : "active";
  if (status === "paused") {
    const probes = history.filter((run) => run.isProbe).slice(-3);
    const recovered = probes.length === 3 && probes.every((run) => Number(run.highValueRate || 0) >= 0.1 || (run.bodySuccessRate !== null && Number(run.bodySuccessRate || 0) >= 0.6));
    if (recovered) return { ...current, status: "limited", reason: "three-successful-probes", nextProbeAt: null, successfulProbes: 3 };
    return { ...current, status, nextProbeAt: new Date(now.getTime() + 7 * 86400000).toISOString() };
  }
  const eligible = windows.days14.runCount >= 5 && windows.days14.metadataCount >= 30;
  if (!eligible) return { ...current, status, reason: "minimum-sample-not-met" };
  if (status === "active" && (windows.days14.highValueRate < 0.1 || windows.days14.duplicateRate > 0.7)) {
    return { ...current, status: "reduced", reason: windows.days14.highValueRate < 0.1 ? "14d-low-high-value-rate" : "14d-high-duplicate-rate" };
  }
  const previous14 = summarizeRuns(history.filter((run) => {
    const age = now.getTime() - new Date(run.generatedAt || 0).getTime();
    return age > 14 * 86400000 && age <= 28 * 86400000;
  }));
  if (status === "reduced" && previous14.runCount > 0 && ((windows.days14.highValueRate < 0.05 && previous14.highValueRate < 0.05) || windows.days14.duplicateRate > 0.85)) {
    return { ...current, status: "limited", reason: "two-window-low-value-or-duplicate" };
  }
  const consecutiveFailures = history.slice(-5).length === 5 && history.slice(-5).every((run) => run.fetchFailed === true);
  if (status === "limited" && (windows.days30.highValueRate < 0.02 || (windows.days30.bodySuccessRate !== null && windows.days30.bodySuccessRate < 0.2) || consecutiveFailures)) {
    return { ...current, status: "paused", reason: consecutiveFailures ? "five-consecutive-fetch-failures" : "30d-source-quality", nextProbeAt: new Date(now.getTime() + 7 * 86400000).toISOString(), successfulProbes: 0 };
  }
  return { ...current, status, reason: "thresholds-not-triggered" };
}

function policyLimits(status, configured = {}) {
  const baseMetadata = Number(configured.metadataLimit || 30);
  const baseBody = Number(configured.bodyFetchQuota || 3);
  const baseInterval = Number(configured.minimumFetchIntervalHours || 6);
  if (status === "reduced") return { metadataLimit: Math.max(1, Math.ceil(baseMetadata / 2)), bodyFetchQuota: Math.max(1, Math.ceil(baseBody / 2)), minimumFetchIntervalHours: baseInterval * 2 };
  if (status === "limited") return { metadataLimit: Math.min(baseMetadata, 5), bodyFetchQuota: 1, minimumFetchIntervalHours: baseInterval * 4 };
  if (status === "paused") return { metadataLimit: Math.min(baseMetadata, 5), bodyFetchQuota: 1, minimumFetchIntervalHours: 168 };
  return { metadataLimit: baseMetadata, bodyFetchQuota: baseBody, minimumFetchIntervalHours: baseInterval };
}

module.exports = { summarizeRuns, metricsForWindows, nextStatus, policyLimits };
