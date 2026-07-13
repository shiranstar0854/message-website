const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) return fallback;
  return JSON.parse(content);
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  JSON.parse(serialized);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, serialized, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function recordFetchAttempts(rootDir, stage, results, generatedAt = new Date().toISOString()) {
  const filePath = path.join(rootDir, "data", "raw", "fetch-run-state.json");
  const previous = readJson(filePath, { generatedAt: "", attempts: {} });
  const previousTime = new Date(previous.generatedAt || 0).getTime();
  const currentTime = new Date(generatedAt).getTime();
  const sameRun = Number.isFinite(previousTime) && currentTime - previousTime <= 30 * 60 * 1000;
  const attempts = sameRun ? { ...(previous.attempts || {}) } : {};
  const sourceById = new Map(readSources(rootDir).map((source) => [source.id, source]));
  (results || []).forEach((result) => {
    const source = sourceById.get(result.sourceId) || {};
    attempts[result.sourceId] = {
      sourceId: result.sourceId,
      stage,
      fetchedAt: result.fetchedAt || generatedAt,
      ok: result.ok === true,
      status: result.status || null,
      itemCount: Number(result.itemCount || result.items?.length || 0),
      error: result.error || null,
      isProbe: source.runtimePolicyStatus === "paused"
    };
  });
  const state = { runId: `fetch-${new Date(generatedAt).toISOString().replace(/[^0-9]/g, "").slice(0, 12)}`, generatedAt, attempts };
  writeJson(filePath, state);
  return state;
}

function readSources(rootDir) {
  const policy = readJson(path.join(rootDir, "data", "processed", "source-policy-state.json"), { sources: {} });
  const now = Date.now();
  return ["tech", "finance", "news"].flatMap((category) => {
    const filePath = path.join(rootDir, "config", `sources.${category}.json`);
    const config = readJson(filePath, { category, sources: [] });
    return (config.sources || []).map((source) => {
      const state = policy.sources?.[source.id] || {};
      const probeDue = !state.nextProbeAt || new Date(state.nextProbeAt).getTime() <= now;
      const runtimePaused = source.enabled !== false && state.status === "paused" && !probeDue;
      const explicitTier = String(source.sourcePolicyTier || "").toLowerCase();
      const legacyTier = String(source.sourceTier || source.tier || "").toUpperCase();
      const sourcePolicyTier = ["core", "standard", "experimental"].includes(explicitTier)
        ? explicitTier
        : legacyTier === "S" || ["official-agency", "official-market"].includes(source.sourceAuthority)
          ? "core"
          : ["A", "B"].includes(legacyTier) || source.sourceAuthority === "official-media" || Number(source.credibility || 0) >= 80
            ? "standard"
            : "experimental";
      const defaultBodyQuota = { core: 5, standard: 3, experimental: 1 }[sourcePolicyTier];
      const minimumFetchIntervalHours = Number(state.minimumFetchIntervalHours || source.minimumFetchIntervalHours || 6);
      const nextEligibleFetchAt = state.lastFetchedAt
        ? new Date(new Date(state.lastFetchedAt).getTime() + minimumFetchIntervalHours * 3600000).toISOString()
        : null;
      const intervalBlocked = nextEligibleFetchAt && new Date(nextEligibleFetchAt).getTime() > now;
      return {
        ...source,
        category,
        enabled: source.enabled !== false,
        runtimeFetchEnabled: source.enabled !== false && !runtimePaused && !intervalBlocked,
        runtimePolicyStatus: state.status || "active",
        runtimePolicyReason: state.reason || "",
        sourcePolicyTier,
        metadataLimit: Number(state.metadataLimit || source.metadataLimit || source.maxItems || 30),
        maxItems: Number(state.metadataLimit || source.metadataLimit || source.maxItems || 30),
        bodyFetchQuota: Number(state.bodyFetchQuota || source.bodyFetchQuota || defaultBodyQuota),
        minimumFetchIntervalHours,
        nextEligibleFetchAt
      };
    });
  });
}

module.exports = {
  readJson,
  writeJson,
  readSources,
  recordFetchAttempts
};
