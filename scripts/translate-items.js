const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");
const { extractArticleKeywords, normalizeText, truncateText } = require("./lib/pipeline");
const {
  detectItemLanguage,
  isLlmConfigured,
  requestDeepSeekSummary
} = require("./generate-ai-summary");

const ROOT_DIR = path.resolve(__dirname, "..");

function sourceLanguage(item) {
  return normalizeText(item.source_language || item.sourceLanguage || detectItemLanguage(item)).toLowerCase();
}

function sourceSummary(item) {
  return item.summary_original || item.summary || item.contentExcerpt || "";
}

function withBaseTranslationFields(item) {
  const language = sourceLanguage(item);
  const titleOriginal = item.title_original || item.title || "";
  const summaryOriginal = sourceSummary(item);
  const base = {
    ...item,
    title_original: truncateText(titleOriginal, 180),
    summary_original: truncateText(summaryOriginal, 500),
    source_language: language,
    sourceLanguage: language
  };

  if (language !== "en") {
    return {
      ...base,
      title_zh: item.title_zh || item.titleZh || item.title || "",
      titleZh: item.title_zh || item.titleZh || item.title || "",
      summary_zh: item.summary_zh || item.summaryZh || item.summary || "",
      summaryZh: item.summary_zh || item.summaryZh || item.summary || "",
      translation_status: "not_required"
    };
  }

  return base;
}

function markTranslationFailed(item, message) {
  return {
    ...withBaseTranslationFields(item),
    translation_status: "failed",
    ...(message ? { translation_error: truncateText(message, 180) } : {})
  };
}

function applyTranslation(item, summary, translatedAt) {
  const titleZh = summary.translatedTitle || item.title_zh || item.titleZh || item.translatedTitle || "";
  const summaryZh = summary.aiSummary || item.summary_zh || item.summaryZh || "";
  const translated = {
    ...withBaseTranslationFields(item),
    translatedTitle: titleZh,
    title_zh: titleZh,
    titleZh,
    summary_zh: summaryZh,
    summaryZh,
    aiSummary: summaryZh,
    summaryReason: summary.summaryReason || item.summaryReason,
    importance: summary.importance || item.importance,
    impactAreas: summary.impactAreas?.length ? summary.impactAreas : item.impactAreas,
    summaryLanguage: "zh",
    translated_at: translatedAt,
    translation_status: titleZh || summaryZh ? "translated" : "failed"
  };
  const articleKeywords = extractArticleKeywords(translated);
  return {
    ...translated,
    ...(articleKeywords.length ? { article_keywords: articleKeywords, keywords: articleKeywords } : {})
  };
}

function mergeChannels(latestData, items) {
  return Object.fromEntries(Object.entries(latestData.channels || {}).map(([id, channel]) => {
    const channelItems = (channel.items || []).map((item) => items.find((candidate) => candidate.id === item.id) || item);
    return [id, { ...channel, items: channelItems }];
  }));
}

async function translateLatestData(latestData, rules = {}, generatedAt = new Date().toISOString(), options = {}) {
  const env = options.env || process.env;
  const configured = isLlmConfigured(rules, env) && rules.llmProduction?.enabled !== false;
  const stats = {
    llmConfigured: configured,
    attempted: 0,
    translated: 0,
    failed: 0,
    notRequired: 0
  };
  const errors = [];
  const items = [];

  for (const item of latestData.items || []) {
    const base = withBaseTranslationFields(item);
    if (base.source_language !== "en") {
      stats.notRequired += 1;
      items.push(base);
      continue;
    }

    stats.attempted += 1;
    if (!configured) {
      stats.failed += 1;
      items.push(markTranslationFailed(base, "LLM translation is not configured."));
      continue;
    }

    try {
      const summary = await requestDeepSeekSummary(base, rules, options);
      const translated = applyTranslation(base, summary, generatedAt);
      if (translated.translation_status === "translated") {
        stats.translated += 1;
      } else {
        stats.failed += 1;
      }
      items.push(translated);
    } catch (error) {
      stats.failed += 1;
      errors.push({ id: base.id, message: truncateText(error.message, 180) });
      items.push(markTranslationFailed(base, error.message));
    }
  }

  return {
    ...latestData,
    channels: mergeChannels(latestData, items),
    translationGeneratedAt: generatedAt,
    translationStats: stats,
    ...(errors.length ? { translationErrors: errors.slice(0, 20) } : {}),
    items
  };
}

async function translateLatestFile(nowIso = new Date().toISOString(), options = {}) {
  const latestPath = path.join(ROOT_DIR, "src", "data", "latest-items.json");
  const latest = readJson(latestPath, { items: [], channels: {} });
  const rules = readJson(path.join(ROOT_DIR, "config", "ai-summary-rules.json"), {});
  const translated = await translateLatestData(latest, rules, nowIso, options);
  writeJson(latestPath, translated);
  return translated;
}

if (require.main === module) {
  translateLatestFile()
    .then((data) => {
      const stats = data.translationStats || {};
      console.log(`Translated ${Number(stats.translated || 0)} items; failed ${Number(stats.failed || 0)}; not required ${Number(stats.notRequired || 0)}.`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  applyTranslation,
  markTranslationFailed,
  translateLatestData,
  translateLatestFile,
  withBaseTranslationFields
};
