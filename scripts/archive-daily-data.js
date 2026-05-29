const path = require("node:path");
const fs = require("node:fs");
const { readJson, writeJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");
const MAX_ITEMS_PER_CHANNEL = 20;
const DEFAULT_RETENTION_DAYS = 10;

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

function buildHistoryIndex(retentionDays = DEFAULT_RETENTION_DAYS) {
  const archiveDir = path.join(ROOT_DIR, "data", "archive", "daily");
  const files = fs.existsSync(archiveDir)
    ? fs.readdirSync(archiveDir).filter((file) => file.endsWith(".json")).sort().reverse()
    : [];
  const retained = files.slice(0, Number(retentionDays || DEFAULT_RETENTION_DAYS));
  const expired = files.slice(Number(retentionDays || DEFAULT_RETENTION_DAYS));

  expired.forEach((file) => {
    fs.unlinkSync(path.join(archiveDir, file));
  });

  const days = retained.map((file) => {
    const archive = readJson(path.join(archiveDir, file), {});
    return {
      date: archive.date || file.replace(/\.json$/, ""),
      generatedAt: archive.generatedAt || "",
      url: `data/archive/daily/${file}`,
      totalItems: Number(archive.items?.length || 0),
      totals: archive.totals || {},
      archivePolicy: archive.archivePolicy || {}
    };
  });

  const index = {
    generatedAt: new Date().toISOString(),
    retentionDays: Number(retentionDays || DEFAULT_RETENTION_DAYS),
    totalDays: days.length,
    days
  };
  writeJson(path.join(ROOT_DIR, "src", "data", "history-index.json"), index);
  return index;
}

function archiveDailyData(dateOverride) {
  const latest = readJson(path.join(ROOT_DIR, "src", "data", "latest-items.json"), { items: [] });
  const health = readJson(path.join(ROOT_DIR, "src", "data", "source-health.json"), { sources: [] });
  const audit = readJson(path.join(ROOT_DIR, "data", "processed", "source-audit.json"), {});
  const rules = readJson(path.join(ROOT_DIR, "config", "ai-summary-rules.json"), {});
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
  buildHistoryIndex(rules.history?.retentionDays || DEFAULT_RETENTION_DAYS);
  return filePath;
}

if (require.main === module) {
  const filePath = archiveDailyData(process.argv[2]);
  console.log(`Archived daily data to ${path.relative(ROOT_DIR, filePath)}.`);
}

module.exports = {
  compactItem,
  selectArchiveItems,
  buildHistoryIndex,
  archiveDailyData
};
