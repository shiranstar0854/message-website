const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");

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

function buildSourceAudit({ health, rawRecords, normalized, filtered, deduped, scored }, generatedAt = new Date().toISOString()) {
  const normalizedCounts = countBySource(normalized);
  const filteredCounts = countBySource(filtered);
  const dedupedCounts = countBySource(deduped);
  const scoredCounts = countBySource(scored);
  const newest = newestBySource(normalized);
  const rawById = new Map(rawRecords.map((record) => [record.sourceId, record]));

  return {
    generatedAt,
    totals: {
      sources: health.sources.length,
      healthySources: health.sources.filter((source) => source.status === "healthy").length,
      rawItems: rawRecords.reduce((total, record) => total + Number(record.itemCount || 0), 0),
      normalizedItems: normalized.length,
      filteredItems: filtered.length,
      dedupedItems: deduped.length,
      scoredItems: scored.length
    },
    sources: health.sources.map((source) => {
      const raw = rawById.get(source.id) || {};
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
        newestPublishedAt: newest[source.name] || null,
        fetchedItems: Number(raw.itemCount || 0),
        normalizedItems: Number(normalizedCounts[source.name] || 0),
        retainedItems: Number(scoredCounts[source.name] || 0),
        filteredOutItems: Number(normalizedCounts[source.name] || 0) - Number(filteredCounts[source.name] || 0),
        deduplicatedItems: Number(filteredCounts[source.name] || 0) - Number(dedupedCounts[source.name] || 0)
      };
    })
  };
}

function generateSourceAudit() {
  const audit = buildSourceAudit({
    health: readJson(path.join(ROOT_DIR, "src", "data", "source-health.json"), { sources: [] }),
    rawRecords: readJson(path.join(ROOT_DIR, "data", "raw", "rss-items.json"), []),
    normalized: readJson(path.join(ROOT_DIR, "data", "normalized", "normalized-items.json"), []),
    filtered: readJson(path.join(ROOT_DIR, "data", "processed", "filtered-items.json"), []),
    deduped: readJson(path.join(ROOT_DIR, "data", "processed", "deduped-items.json"), []),
    scored: readJson(path.join(ROOT_DIR, "data", "processed", "scored-items.json"), [])
  });
  writeJson(path.join(ROOT_DIR, "data", "processed", "source-audit.json"), audit);
  return audit;
}

if (require.main === module) {
  const audit = generateSourceAudit();
  console.log(`Audited ${audit.totals.sources} sources; ${audit.totals.healthySources} healthy.`);
}

module.exports = {
  buildSourceAudit,
  generateSourceAudit
};
