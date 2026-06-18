const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");
const { loadLocalEnv } = require("./lib/load-local-env");
const { extractArticleKeywords, normalizeText, truncateText } = require("./lib/pipeline");
const {
  detectItemLanguage,
  isLlmConfigured,
  requestDeepSeekSummary
} = require("./generate-ai-summary");

const ROOT_DIR = path.resolve(__dirname, "..");

function sourceLanguage(item) {
  return normalizeText(item.source_language || item.sourceLanguage || detectItemLanguage(item) || "unknown").toLowerCase();
}

function isChineseLanguage(language) {
  const value = normalizeText(language).toLowerCase();
  return value === "zh" || value.startsWith("zh-") || value === "cn" || value === "chinese";
}

function needsAiTranslation(item) {
  return !isChineseLanguage(sourceLanguage(item));
}

function hasChineseText(value) {
  return /[\u4e00-\u9fff]/u.test(String(value || ""));
}

function translationMaxAttempts(rules = {}, options = {}) {
  const env = options.env || process.env;
  return Math.max(
    1,
    Number(
      options.translationMaxAttempts
        || env.TRANSLATION_MAX_ATTEMPTS
        || rules.llmProduction?.requiredTranslationMaxAttempts
        || rules.llmProduction?.translationMaxAttempts
        || 5
    )
  );
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

  if (!needsAiTranslation(base)) {
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
  const translatedSuccessfully = needsAiTranslation(item)
    ? Boolean(titleZh && summaryZh && hasChineseText(`${titleZh} ${summaryZh}`))
    : Boolean(titleZh || summaryZh);
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
    translation_status: translatedSuccessfully ? "translated" : "failed"
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

async function translateItemWithRetries(base, rules, generatedAt, options = {}) {
  const attempts = translationMaxAttempts(rules, options);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const summary = await requestDeepSeekSummary(base, rules, options);
      const translated = applyTranslation(base, summary, generatedAt);
      if (translated.translation_status === "translated") {
        return {
          ...translated,
          translation_attempts: attempt
        };
      }
      throw new Error("AI translation response did not include required Chinese title and summary.");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
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
    if (!needsAiTranslation(base)) {
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
      const translated = await translateItemWithRetries(base, rules, generatedAt, options);
      stats.translated += 1;
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
  loadLocalEnv(ROOT_DIR);
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
  hasChineseText,
  needsAiTranslation,
  markTranslationFailed,
  translateItemWithRetries,
  translationMaxAttempts,
  translateLatestData,
  translateLatestFile,
  withBaseTranslationFields
};
