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
    ...(item.title_original ? { title_original: String(item.title_original).slice(0, 180) } : {}),
    ...(item.title_zh ? { title_zh: String(item.title_zh).slice(0, 120) } : {}),
    ...(item.translatedTitle ? { translatedTitle: String(item.translatedTitle).slice(0, 120) } : {}),
    url: item.url,
    original_url: item.original_url || item.url,
    source: item.source,
    sourceType: item.sourceType,
    category: item.category,
    ...(item.sourceCategory ? { sourceCategory: item.sourceCategory } : {}),
    ...(item.displayChannel ? { displayChannel: item.displayChannel } : {}),
    ...(item.secondaryTags?.length ? { secondaryTags: item.secondaryTags.slice(0, 6) } : {}),
    publishedAt: item.publishedAt,
    summary: String(item.summary || "").slice(0, 500),
    ...(item.summary_original ? { summary_original: String(item.summary_original).slice(0, 500) } : {}),
    ...(item.summary_zh ? { summary_zh: String(item.summary_zh).slice(0, 500) } : {}),
    ...(item.contentExcerpt ? { contentExcerpt: String(item.contentExcerpt).slice(0, 500) } : {}),
    ...(item.aiSummary ? { aiSummary: String(item.aiSummary).slice(0, 240) } : {}),
    ...(item.summary_short ? { summary_short: String(item.summary_short).slice(0, 140) } : {}),
    ...(item.summary_points?.length ? { summary_points: item.summary_points.slice(0, 5).map((point) => String(point).slice(0, 180)) } : {}),
    ...(item.key_data?.length ? { key_data: item.key_data.slice(0, 8).map((point) => String(point).slice(0, 80)) } : {}),
    ...(item.why_it_matters ? { why_it_matters: String(item.why_it_matters).slice(0, 240) } : {}),
    ...(item.impact ? { impact: String(item.impact).slice(0, 240) } : {}),
    ...(item.risks ? { risks: String(item.risks).slice(0, 240) } : {}),
    ...(item.neutrality_check ? { neutrality_check: String(item.neutrality_check).slice(0, 180) } : {}),
    ...(item.confidence ? { confidence: item.confidence } : {}),
    ...(item.timeline_event_id ? { timeline_event_id: item.timeline_event_id } : {}),
    ...(item.ai_model ? { ai_model: item.ai_model } : {}),
    ...(item.ai_generated_at ? { ai_generated_at: item.ai_generated_at } : {}),
    ...(item.summaryReason ? { summaryReason: String(item.summaryReason).slice(0, 160) } : {}),
    ...(item.importance ? { importance: String(item.importance).slice(0, 180) } : {}),
    ...(item.sourceLanguage ? { sourceLanguage: item.sourceLanguage } : {}),
    ...(item.source_language ? { source_language: item.source_language } : {}),
    ...(item.summaryLanguage ? { summaryLanguage: item.summaryLanguage } : {}),
    ...(item.translated_at ? { translated_at: item.translated_at } : {}),
    ...(item.translation_status ? { translation_status: item.translation_status } : {}),
    ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
    score: item.score,
    importance_score: Number(item.importance_score || item.score || 0),
    duplicateCount: Number(item.duplicateCount || 0),
    tags: (item.tags || []).slice(0, 8),
    ...(item.article_keywords?.length ? { article_keywords: item.article_keywords.slice(0, 8) } : {}),
    ...(item.keywords?.length ? { keywords: item.keywords.slice(0, 8) } : {}),
    ...(item.impactAreas?.length ? { impactAreas: item.impactAreas.slice(0, 4) } : {}),
    ...(item.article_brief?.schema_version === "article-brief.v1" ? { article_brief: item.article_brief } : {})
  };
}

function selectArchiveItems(items) {
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];
  return categories.flatMap((category) => items
    .filter((item) => item.category === category)
    .slice(0, MAX_ITEMS_PER_CHANNEL));
}

function buildHistoryIndex(retentionDays = DEFAULT_RETENTION_DAYS, options = {}) {
  const archiveDir = options.archiveDir || path.join(ROOT_DIR, "data", "archive", "daily");
  const historyIndexPath = options.historyIndexPath || path.join(ROOT_DIR, "src", "data", "history-index.json");
  const files = fs.existsSync(archiveDir)
    ? fs.readdirSync(archiveDir).filter((file) => file.endsWith(".json"))
    : [];
  const visibleDays = Number(retentionDays || DEFAULT_RETENTION_DAYS);

  const allDays = files.map((file) => {
    const archive = readJson(path.join(archiveDir, file), {});
    return {
      date: archive.date || file.replace(/\.json$/, ""),
      generatedAt: archive.generatedAt || "",
      url: `data/archive/daily/${file}`,
      totalItems: Number(archive.items?.length || 0),
      eventCount: Number(archive.events?.length || 0),
      hasBrief: archive.brief?.schema_version === "daily-brief.v6",
      briefUrl: archive.brief?.schema_version === "daily-brief.v6" ? `data/archive/daily/${file}` : null,
      totals: archive.totals || {},
      archivePolicy: archive.archivePolicy || {}
    };
  }).sort((a, b) => String(b.date || b.generatedAt).localeCompare(String(a.date || a.generatedAt)));
  const days = allDays.slice(0, visibleDays);

  const index = {
    generatedAt: options.now || new Date().toISOString(),
    retentionDays: visibleDays,
    totalArchiveDays: allDays.length,
    totalDays: days.length,
    days
  };
  writeJson(historyIndexPath, index);
  return index;
}

function archiveDailyData(dateOverride) {
  const latest = readJson(path.join(ROOT_DIR, "src", "data", "latest-items.json"), { items: [] });
  const dailyBrief = readJson(path.join(ROOT_DIR, "src", "data", "daily-summary.json"), null);
  const dailyEvents = readJson(path.join(ROOT_DIR, "data", "processed", "daily-events.json"), { events: [] });
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
    brief: dailyBrief?.schema_version === "daily-brief.v6" ? dailyBrief : null,
    events: dailyEvents.events || [],
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
