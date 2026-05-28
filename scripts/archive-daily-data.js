const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");
const MAX_ITEMS_PER_CHANNEL = 20;

function compactItem(item) {
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    source: item.source,
    sourceType: item.sourceType,
    category: item.category,
    publishedAt: item.publishedAt,
    summary: String(item.summary || "").slice(0, 500),
    ...(item.contentExcerpt ? { contentExcerpt: String(item.contentExcerpt).slice(0, 500) } : {}),
    ...(item.aiSummary ? { aiSummary: String(item.aiSummary).slice(0, 240) } : {}),
    ...(item.summaryReason ? { summaryReason: String(item.summaryReason).slice(0, 160) } : {}),
    ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
    score: item.score,
    duplicateCount: Number(item.duplicateCount || 0),
    tags: (item.tags || []).slice(0, 8)
  };
}

function selectArchiveItems(items) {
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];
  return categories.flatMap((category) => items
    .filter((item) => item.category === category)
    .slice(0, MAX_ITEMS_PER_CHANNEL));
}

function archiveDailyData(dateOverride) {
  const latest = readJson(path.join(ROOT_DIR, "src", "data", "latest-items.json"), { items: [] });
  const health = readJson(path.join(ROOT_DIR, "src", "data", "source-health.json"), { sources: [] });
  const audit = readJson(path.join(ROOT_DIR, "data", "processed", "source-audit.json"), {});
  const archiveDate = dateOverride || String(latest.generatedAt || new Date().toISOString()).slice(0, 10);
  const snapshot = {
    date: archiveDate,
    generatedAt: latest.generatedAt,
    totals: audit.totals || { scoredItems: latest.totalItems || latest.items.length },
    sourceHealth: health.sources,
    archivePolicy: {
      maxItemsPerChannel: MAX_ITEMS_PER_CHANNEL,
      availableItems: Number(latest.totalItems || latest.items.length)
    },
    items: selectArchiveItems(latest.items || []).map(compactItem)
  };
  const filePath = path.join(ROOT_DIR, "data", "archive", "daily", `${archiveDate}.json`);
  writeJson(filePath, snapshot);
  return filePath;
}

if (require.main === module) {
  const filePath = archiveDailyData(process.argv[2]);
  console.log(`Archived daily data to ${path.relative(ROOT_DIR, filePath)}.`);
}

module.exports = {
  compactItem,
  selectArchiveItems,
  archiveDailyData
};
