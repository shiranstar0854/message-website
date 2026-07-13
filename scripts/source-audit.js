const path = require("node:path");
const { readJson, readSources, writeJson } = require("./lib/file-utils");
const { metricsForWindows, nextStatus, policyLimits } = require("./lib/source-policy");

const ROOT_DIR = path.resolve(__dirname, "..");

function countBySource(items) {
  return items.reduce((counts, item) => {
    counts[item.source] = (counts[item.source] || 0) + 1;
    return counts;
  }, {});
}

function newestBySource(items) {
  return items.reduce((newest, item) => {
    if (!item.source || !item.publishedAt) return newest;
    if (!newest[item.source] || item.publishedAt > newest[item.source]) {
      newest[item.source] = item.publishedAt;
    }
    return newest;
  }, {});
}

function buildPerformanceRun(source, attempt, generatedAt) {
  const fetchedCount = Math.max(0, Number(attempt?.itemCount || 0));
  const passedCount = Math.min(fetchedCount, Math.max(0, Number(source.retainedItems || 0)));
  const duplicateCount = Math.min(fetchedCount, Math.max(0, Number(source.deduplicatedItems || 0)));
  const highValueCount = Math.min(fetchedCount, Math.max(0, Math.round(Number(source.highValueRate || 0) * Number(source.fetchedCount || 0))));
  const bodyAttemptCount = fetchedCount ? Math.max(0, Number(source.enrichmentAttempted || 0)) : 0;
  const bodySuccessCount = Math.min(bodyAttemptCount, Math.max(0, Math.round(Number(source.bodySuccessRate || 0) * bodyAttemptCount)));
  const densityCount = fetchedCount ? Math.max(0, Number(source.reviewedItems || 0)) : 0;
  return {
    generatedAt,
    fetchedCount,
    passedCount,
    duplicateCount,
    highValueCount,
    bodyAttemptCount,
    bodySuccessCount,
    densityTotal: Number(source.averageInformationDensity || 0) * densityCount,
    densityCount,
    fetchFailed: attempt?.ok !== true,
    isProbe: attempt?.isProbe === true,
    highValueRate: fetchedCount ? highValueCount / fetchedCount : 0,
    bodySuccessRate: bodyAttemptCount ? bodySuccessCount / bodyAttemptCount : null
  };
}

function buildSourceAudit({ health, rawRecords, normalized, filtered, deduped, scored, enrichment, candidates = [], reviewed = [] }, generatedAt = new Date().toISOString()) {
  const normalizedCounts = countBySource(normalized);
  const filteredCounts = countBySource(filtered);
  const dedupedCounts = countBySource(deduped);
  const scoredCounts = countBySource(scored);
  const newest = newestBySource(normalized);
  const rawById = new Map(rawRecords.map((record) => [record.sourceId, record]));
  const candidatesBySource = countBySource(candidates);
  const reviewedBySource = countBySource(reviewed);

  return {
    generatedAt,
    totals: {
      sources: health.sources.length,
      healthySources: health.sources.filter((source) => source.status === "healthy").length,
      rawItems: rawRecords.reduce((total, record) => total + Number(record.itemCount || 0), 0),
      normalizedItems: normalized.length,
      filteredItems: filtered.length,
      dedupedItems: deduped.length,
      scoredItems: scored.length,
      enrichmentAttempted: Number(enrichment?.totals?.attempted || 0),
      enrichmentFailed: Number(enrichment?.totals?.failed || 0)
    },
    sources: health.sources.map((source) => {
      const raw = rawById.get(source.id) || {};
      const enrichmentStats = enrichment?.sources?.[source.id] || {};
      const fetchedCount = Number(raw.itemCount || normalizedCounts[source.name] || 0);
      const passedCount = Number(scoredCounts[source.name] || 0);
      const duplicateCount = Math.max(0, Number(filteredCounts[source.name] || 0) - Number(dedupedCounts[source.name] || 0));
      const bodyAttempts = Number(enrichmentStats.attempted || 0);
      const bodySuccess = Math.max(0, bodyAttempts - Number(enrichmentStats.failed || 0));
      const sourceReviewed = reviewed.filter((item) => item.source === source.name);
      const densityValues = sourceReviewed.map((item) => Number(item.contentDensity || 0)).filter((value) => value > 0);
      return {
        id: source.id,
        name: source.name,
        category: source.category,
        status: source.status,
        usedFallback: raw.stale === true,
        responseStatus: source.responseStatus || null,
        attempts: Number(source.attempts || 1),
        error: source.error || null,
        failureCount: source.failureCount,
        lastCheckedAt: source.lastCheckedAt,
        lastSuccessAt: source.lastSuccessAt,
        cacheTtlHours: source.cacheTtlHours || null,
        cacheStartedAt: source.cacheStartedAt || null,
        cacheExpiresAt: source.cacheExpiresAt || null,
        newestPublishedAt: newest[source.name] || null,
        fetchedItems: fetchedCount,
        normalizedItems: Number(normalizedCounts[source.name] || 0),
        retainedItems: Number(scoredCounts[source.name] || 0),
        filteredOutItems: Number(normalizedCounts[source.name] || 0) - Number(filteredCounts[source.name] || 0),
        deduplicatedItems: Number(filteredCounts[source.name] || 0) - Number(dedupedCounts[source.name] || 0),
        enrichmentAttempted: Number(enrichmentStats.attempted || 0),
        enrichmentExcerptCount: Number(enrichmentStats.excerptCount || 0),
        enrichmentImageCount: Number(enrichmentStats.imageCount || 0),
        enrichmentFailedCount: Number(enrichmentStats.failed || 0),
        fetchedCount,
        passRate: fetchedCount ? Number((passedCount / fetchedCount).toFixed(4)) : 0,
        duplicateRate: fetchedCount ? Number((duplicateCount / fetchedCount).toFixed(4)) : 0,
        highValueRate: fetchedCount ? Number((Number(candidatesBySource[source.name] || 0) / fetchedCount).toFixed(4)) : 0,
        bodySuccessRate: bodyAttempts ? Number((bodySuccess / bodyAttempts).toFixed(4)) : null,
        averageInformationDensity: densityValues.length ? Number((densityValues.reduce((sum, value) => sum + value, 0) / densityValues.length).toFixed(2)) : 0,
        reviewedItems: Number(reviewedBySource[source.name] || 0)
      };
    })
  };
}

function generateSourceAudit() {
  const rawRecords = [
    ...readJson(path.join(ROOT_DIR, "data", "raw", "rss-items.json"), []),
    ...readJson(path.join(ROOT_DIR, "data", "raw", "webpage-items.json"), []),
    ...readJson(path.join(ROOT_DIR, "data", "raw", "api-items.json"), [])
  ];
  const candidateData = readJson(path.join(ROOT_DIR, "data", "processed", "candidate-items.json"), { items: [] });
  const reviewedData = readJson(path.join(ROOT_DIR, "data", "processed", "content-reviewed-items.json"), { items: [] });
  const audit = buildSourceAudit({
    health: readJson(path.join(ROOT_DIR, "src", "data", "source-health.json"), { sources: [] }),
    rawRecords,
    normalized: readJson(path.join(ROOT_DIR, "data", "normalized", "normalized-items.json"), []),
    filtered: readJson(path.join(ROOT_DIR, "data", "processed", "filtered-items.json"), []),
    deduped: readJson(path.join(ROOT_DIR, "data", "processed", "deduped-items.json"), []),
    scored: readJson(path.join(ROOT_DIR, "data", "processed", "scored-items.json"), []),
    enrichment: readJson(path.join(ROOT_DIR, "data", "processed", "article-enrichment.json"), {}),
    candidates: [...(candidateData.items || []), ...(candidateData.rejected || [])].filter((item) => Number(item.candidateValue || 0) >= 60),
    reviewed: reviewedData.items || []
  });
  const historyPath = path.join(ROOT_DIR, "data", "processed", "source-performance-history.json");
  const policyPath = path.join(ROOT_DIR, "data", "processed", "source-policy-state.json");
  const fetchRun = readJson(path.join(ROOT_DIR, "data", "raw", "fetch-run-state.json"), { attempts: {} });
  const history = readJson(historyPath, { sources: {} });
  const previousPolicy = readJson(policyPath, { sources: {} });
  const configuredSources = readSources(ROOT_DIR);
  const configuredById = new Map(configuredSources.map((source) => [source.id, source]));
  const nextHistory = { generatedAt: audit.generatedAt, sources: { ...(history.sources || {}) } };
  const nextPolicy = { generatedAt: audit.generatedAt, sources: {} };
  audit.sources.forEach((source) => {
    const previousState = previousPolicy.sources?.[source.id] || { status: "active" };
    const attempt = fetchRun.attempts?.[source.id];
    const freshAttempt = attempt && new Date(attempt.fetchedAt || 0).getTime() > new Date(previousState.lastAuditedFetchAt || 0).getTime();
    const run = buildPerformanceRun(source, attempt, audit.generatedAt);
    if (freshAttempt) {
      source.fetchedCount = run.fetchedCount;
      source.passRate = run.fetchedCount ? Number((run.passedCount / run.fetchedCount).toFixed(4)) : 0;
      source.duplicateRate = run.fetchedCount ? Number((run.duplicateCount / run.fetchedCount).toFixed(4)) : 0;
      source.highValueRate = run.highValueRate;
      source.bodySuccessRate = run.bodySuccessRate;
      source.averageInformationDensity = run.densityCount ? Number((run.densityTotal / run.densityCount).toFixed(2)) : 0;
    }
    const existingRuns = nextHistory.sources[source.id] || [];
    const runs = [...existingRuns, ...(freshAttempt ? [run] : [])].filter((entry) => new Date(entry.generatedAt).getTime() >= Date.now() - 35 * 86400000);
    nextHistory.sources[source.id] = runs;
    const windows = metricsForWindows(runs, new Date(audit.generatedAt));
    const status = freshAttempt ? nextStatus(previousState, windows, runs, new Date(audit.generatedAt)) : previousState;
    const configured = configuredById.get(source.id) || {};
    nextPolicy.sources[source.id] = {
      ...status,
      ...policyLimits(status.status, configured),
      windows,
      lastFetchedAt: freshAttempt ? attempt.fetchedAt : previousState.lastFetchedAt || null,
      lastAuditedFetchAt: freshAttempt ? attempt.fetchedAt : previousState.lastAuditedFetchAt || null,
      updatedAt: audit.generatedAt
    };
    source.performanceWindows = windows;
    source.policyStatus = status.status;
    source.policyReason = status.reason;
    source.actualRunRecorded = Boolean(freshAttempt);
  });
  writeJson(path.join(ROOT_DIR, "data", "processed", "source-audit.json"), audit);
  writeJson(historyPath, nextHistory);
  writeJson(policyPath, nextPolicy);
  const previousHealth = readJson(path.join(ROOT_DIR, "src", "data", "source-health.json"), { sources: [] });
  const performanceById = new Map(audit.sources.map((source) => [source.id, source]));
  writeJson(path.join(ROOT_DIR, "src", "data", "source-health.json"), {
    ...previousHealth,
    generatedAt: audit.generatedAt,
    sources: (previousHealth.sources || []).map((source) => {
      const performance = performanceById.get(source.id);
      return performance ? {
        ...source,
        fetchedCount: performance.fetchedCount,
        passRate: performance.passRate,
        duplicateRate: performance.duplicateRate,
        highValueRate: Math.min(1, performance.highValueRate),
        bodySuccessRate: performance.bodySuccessRate,
        averageInformationDensity: performance.averageInformationDensity,
        policyStatus: performance.policyStatus,
        policyReason: performance.policyReason
      } : source;
    }),
    performance: audit.sources
  });
  return audit;
}

if (require.main === module) {
  const audit = generateSourceAudit();
  console.log(`Audited ${audit.totals.sources} sources; ${audit.totals.healthySources} healthy.`);
}

module.exports = {
  buildSourceAudit,
  buildPerformanceRun,
  generateSourceAudit
};
