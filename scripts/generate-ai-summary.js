const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");
const { loadLocalEnv } = require("./lib/load-local-env");
const { extractPublishedKeywords, normalizeText, sortItems, truncateText } = require("./lib/pipeline");
const {
  getLlmConfig,
  isLlmConfigured,
  buildDeepSeekRequestBody,
  extractChatCompletionText,
  requestDeepSeekJson
} = require("./lib/deepseek-summary-client");
const {
  buildStructuredSummaryPrompt,
  buildExtractiveStructuredSummary,
  buildStructuredFieldsFromResponse
} = require("./lib/ai-summarizer");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_CHANNELS = ["tech", "finance", "news"];
const CHANNEL_LABELS = {
  tech: "科技",
  finance: "金融",
  news: "新闻"
};

function detectItemLanguage(item) {
  const text = normalizeText(`${item.title || ""} ${item.contentExcerpt || ""} ${item.summary || ""}`);
  const cjkCount = (text.match(/[\u4e00-\u9fff]/gu) || []).length;
  const latinWords = text.match(/[A-Za-z][A-Za-z'-]{2,}/g) || [];
  if (latinWords.length >= 6 && cjkCount < 6) return "en";
  if (cjkCount >= 6) return "zh";
  return "unknown";
}

function isChineseLanguage(language) {
  const value = normalizeText(language).toLowerCase();
  return value === "zh" || value.startsWith("zh-") || value === "cn" || value === "chinese";
}

function hasChineseText(value) {
  return /[\u4e00-\u9fff]/u.test(String(value || ""));
}

function needsChineseTranslation(item) {
  const explicitLanguage = normalizeText(item.source_language || item.sourceLanguage || "").toLowerCase();
  if (explicitLanguage) return !isChineseLanguage(explicitLanguage);
  return detectItemLanguage(item) !== "zh";
}

function requiredTranslationMaxAttempts(rules = {}, options = {}) {
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

function hasRequiredChineseTranslation(item) {
  if (!needsChineseTranslation(item)) return true;
  return Boolean(item.title_zh && item.summary_zh && hasChineseText(`${item.title_zh} ${item.summary_zh}`));
}

function isLikelyEnglishItem(item) {
  return needsChineseTranslation(item);
}

function splitSentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+|(?<=[\u3002\uff01\uff1f])\s*|\n+/u)
    .map((sentence) => normalizeText(sentence))
    .filter(Boolean);
}

function summarizeText(item, maxLength = 180) {
  const sourceText = item.contentExcerpt || item.summary || item.title || "";
  const sentences = splitSentences(sourceText);
  const summary = sentences.find((sentence) => sentence.length >= 24) || sentences[0] || sourceText || item.title;
  return truncateText(summary, maxLength);
}

function buildReason(item, maxLength = 120) {
  const parts = [
    `${item.source || "Unknown source"} / ${item.category || "news"}`,
    `score ${Number(item.score || 0)}`,
    ...(item.tags || []).slice(0, 2)
  ].filter(Boolean);
  return truncateText(parts.join(" · "), maxLength);
}

function buildImportance(item, maxLength = 140) {
  const parts = [
    item.sourceAuthority?.startsWith("official") ? "官方来源" : item.source || "来源",
    `评分 ${Number(item.score || 0)}`,
    item.duplicateCount > 0 ? `合并 ${Number(item.duplicateCount)} 条重复` : "",
    item.timelinessTier ? `更新频率 ${item.timelinessTier}` : ""
  ].filter(Boolean);
  return truncateText(parts.join("；"), maxLength);
}

function buildItemSummaryRules(rules = {}) {
  const llm = rules.llmProduction || {};
  return {
    ...rules,
    llmProduction: {
      ...llm,
      requiredSecret: llm.itemRequiredSecret || llm.aiSummaryRequiredSecret || "DEEPSEEK_API_KEY1"
    }
  };
}

function shouldSummarize(item, rules) {
  return Number(item.score || 0) >= Number(rules.minimumScore || 0)
    && Boolean(item.title)
    && Boolean(item.url);
}

function selectSummaryIds(latestData, dailyRules = {}) {
  const maxItemsPerChannel = Number(dailyRules.maxItemsPerChannel || 20);
  const maxItemsTotal = Number(dailyRules.maxItemsTotal || 0);
  const maxTranslationItems = Number(dailyRules.maxNonChineseTranslationItems || dailyRules.maxEnglishTranslationItems || 30);
  const coverage = dailyRules.summaryCoverage || dailyRules.llmCoverage || "all";
  const selectedIds = new Set();
  const allCandidates = sortItems((latestData.items || []).filter((item) => shouldSummarize(item, dailyRules)));

  if (coverage === "all") {
    (maxItemsTotal > 0 ? allCandidates.slice(0, maxItemsTotal) : allCandidates)
      .forEach((item) => selectedIds.add(item.id));
  } else {
    DEFAULT_CHANNELS.forEach((channel) => {
      sortItems((latestData.items || []).filter((item) => item.category === channel && shouldSummarize(item, dailyRules)))
        .slice(0, maxItemsPerChannel)
        .forEach((item) => selectedIds.add(item.id));
    });
  }

  sortItems((latestData.items || []).filter((item) => (
    needsChineseTranslation(item)
      && Boolean(item.title)
      && Boolean(item.url)
      && Boolean(item.contentExcerpt || item.summary)
      && Number(item.score || 0) >= Number(dailyRules.translateEnglishMinimumScore || 0)
  )))
    .slice(0, maxTranslationItems)
    .forEach((item) => selectedIds.add(item.id));

  return selectedIds;
}

function mergeItemsIntoChannels(latestData, items) {
  return Object.fromEntries(Object.entries(latestData.channels || {}).map(([id, channel]) => {
    const channelItems = (channel.items || []).map((item) => items.find((candidate) => candidate.id === item.id) || item);
    return [id, { ...channel, items: channelItems }];
  }));
}

function applyExtractiveSummary(item, rules, generatedAt) {
  const sourceLanguage = detectItemLanguage(item);
  const structured = buildExtractiveStructuredSummary(item, generatedAt, "extractive");
  const summarized = {
    ...item,
    ...structured,
    title_original: item.title_original || item.title,
    summary_original: item.summary_original || item.summary || item.contentExcerpt || "",
    aiSummary: structured.summary_short || summarizeText(item, rules.summaryMaxLength),
    summaryReason: buildReason(item, rules.reasonMaxLength),
    importance: structured.why_it_matters || buildImportance(item, rules.importanceMaxLength),
    source_language: item.source_language || sourceLanguage,
    sourceLanguage,
    translation_status: item.translation_status || (needsChineseTranslation({ ...item, sourceLanguage }) ? "failed" : "not_required"),
    summaryMethod: "extractive",
    summaryGeneratedAt: generatedAt
  };
  return {
    ...summarized,
    article_keywords: extractPublishedKeywords(summarized),
    keywords: extractPublishedKeywords(summarized)
  };
}

async function applyLlmSummary(item, rules, generatedAt, options = {}) {
  const summary = await requestDeepSeekSummary(item, rules, { ...options, generatedAt });
  const sourceLanguage = detectItemLanguage(item);
  const titleZh = summary.translatedTitle || item.title_zh || item.titleZh || item.translatedTitle;
  const summaryZh = summary.summary_short || summary.aiSummary || item.summary_zh || item.summaryZh;
  const summarized = {
    ...item,
    ...summary,
    title_original: item.title_original || item.title,
    title_zh: titleZh,
    summary_original: item.summary_original || item.summary || item.contentExcerpt || "",
    summary_zh: summaryZh,
    source_language: item.source_language || sourceLanguage,
    sourceLanguage,
    summaryLanguage: "zh",
    translated_at: generatedAt,
    summaryMethod: getLlmConfig(rules).provider,
    summaryGeneratedAt: generatedAt
  };
  summarized.translation_status = hasRequiredChineseTranslation(summarized)
    ? (needsChineseTranslation(summarized) ? "translated" : "not_required")
    : "failed";
  return {
    ...summarized,
    article_keywords: extractPublishedKeywords(summarized),
    keywords: extractPublishedKeywords(summarized)
  };
}

function summarizeLatestData(latestData, rules = {}, generatedAt = new Date().toISOString()) {
  const dailyRules = rules.daily || {};
  const selectedIds = selectSummaryIds(latestData, dailyRules);
  const items = (latestData.items || []).map((item) => (
    selectedIds.has(item.id) ? applyExtractiveSummary(item, dailyRules, generatedAt) : item
  ));
  const channels = mergeItemsIntoChannels(latestData, items);

  return {
    ...latestData,
    generatedAt: latestData.generatedAt || generatedAt,
    summaryGeneratedAt: generatedAt,
    summaryMethod: rules.method || "extractive",
    channels,
    items
  };
}

function buildSummaryPrompt(item, dailyRules = {}) {
  return buildStructuredSummaryPrompt(item, dailyRules);
}

function parseSummaryResponse(responseJson, item, dailyRules = {}) {
  const generatedAt = dailyRules.generatedAt || new Date().toISOString();
  const compatibleResponse = responseJson.summary_short || responseJson.summary_points || responseJson.what_happened || responseJson.confirmed_facts
    ? responseJson
    : {
      summary_short: responseJson.aiSummary || responseJson.summary || "",
      summary_points: responseJson.summaryPoints || [responseJson.aiSummary || responseJson.summary || ""].filter(Boolean),
      key_data: responseJson.keyData || [],
      why_it_matters: responseJson.importance || responseJson.summaryReason || "",
      impact: Array.isArray(responseJson.impactAreas) ? responseJson.impactAreas.join("、") : "",
      risks: responseJson.risks || "不足以判断",
      neutrality_check: responseJson.neutrality_check || responseJson.summaryReason || "仅基于原文信息生成。",
      confidence: responseJson.confidence || "medium"
    };
  const structured = buildStructuredFieldsFromResponse(
    item,
    compatibleResponse,
    generatedAt,
    dailyRules.aiModel || "deepseek"
  );
  const summaryShort = structured.summary_short || summarizeText(item, dailyRules.summaryMaxLength);
  return {
    translatedTitle: truncateText(responseJson.translatedTitle || responseJson.title_zh || responseJson.titleZh || "", 120),
    aiSummary: truncateText(responseJson.aiSummary || structured.what_happened || summaryShort, dailyRules.summaryMaxLength || 180),
    summaryReason: truncateText(responseJson.summaryReason || structured.neutrality_check || buildReason(item, dailyRules.reasonMaxLength), dailyRules.reasonMaxLength || 120),
    importance: truncateText(responseJson.importance || structured.what_changed || structured.why_it_matters || buildImportance(item, dailyRules.importanceMaxLength), dailyRules.importanceMaxLength || 140),
    impactAreas: Array.isArray(responseJson.impactAreas)
      ? responseJson.impactAreas.slice(0, 4).map((value) => truncateText(value, 20)).filter(Boolean)
      : [],
    ...structured
  };
}

async function requestDeepSeekSummary(item, rules = {}, options = {}) {
  const llm = getLlmConfig(rules);
  const dailyRules = {
    ...(rules.daily || {}),
    generatedAt: options.generatedAt || new Date().toISOString(),
    aiModel: llm.model || llm.provider
  };
  const responseJson = await requestDeepSeekJson(buildSummaryPrompt(item, dailyRules), rules, options);
  return parseSummaryResponse(responseJson, item, dailyRules);
}

async function summarizeLatestDataWithLlm(latestData, rules = {}, generatedAt = new Date().toISOString(), options = {}) {
  const dailyRules = rules.daily || {};
  const selectedIds = selectSummaryIds(latestData, dailyRules);
  const env = options.env || process.env;
  const itemSummaryRules = buildItemSummaryRules(rules);
  const llmConfigured = isLlmConfigured(itemSummaryRules, env);
  const stats = {
    llmEnabled: Boolean(itemSummaryRules.llmProduction?.enabled),
    llmConfigured,
    llmAttempted: 0,
    llmSucceeded: 0,
    fallbackCount: 0,
    errorCount: 0
  };
  const errors = [];
  const items = [];

  for (const item of latestData.items || []) {
    if (!selectedIds.has(item.id)) {
      items.push(item);
      continue;
    }

    if (!llmConfigured || !itemSummaryRules.llmProduction?.enabled) {
      stats.fallbackCount += 1;
      items.push(applyExtractiveSummary(item, dailyRules, generatedAt));
      continue;
    }

    stats.llmAttempted += 1;
    const attempts = needsChineseTranslation(item) ? requiredTranslationMaxAttempts(itemSummaryRules, options) : 1;
    let lastError;
    let llmItem;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        llmItem = await applyLlmSummary(item, itemSummaryRules, generatedAt, options);
        if (hasRequiredChineseTranslation(llmItem)) {
          llmItem = { ...llmItem, translation_attempts: attempt };
          break;
        }
        throw new Error("AI summary response did not include required Chinese title and summary.");
      } catch (error) {
        lastError = error;
        llmItem = undefined;
      }
    }

    if (llmItem) {
      stats.llmSucceeded += 1;
      items.push(llmItem);
    } else {
      stats.fallbackCount += 1;
      stats.errorCount += 1;
      errors.push({ id: item.id, message: truncateText(lastError?.message || "AI summary failed.", 180) });
      const fallbackItem = applyExtractiveSummary(item, dailyRules, generatedAt);
      items.push({
        ...fallbackItem,
        translation_status: needsChineseTranslation(item) && !hasRequiredChineseTranslation(item)
          ? "failed"
          : fallbackItem.translation_status
      });
    }
  }

  const channels = mergeItemsIntoChannels(latestData, items);

  return {
    ...latestData,
    generatedAt: latestData.generatedAt || generatedAt,
    summaryGeneratedAt: generatedAt,
    summaryMethod: stats.llmSucceeded > 0 ? getLlmConfig(itemSummaryRules, env).provider : (rules.method || "extractive"),
    summaryStats: stats,
    ...(errors.length ? { summaryErrors: errors.slice(0, 20) } : {}),
    channels,
    items
  };
}

function buildExtractiveChannelSummary(channelId, items, rules = {}) {
  const topItems = sortItems(items).slice(0, Number(rules.daily?.maxHighlightsPerChannel || 5));
  const titles = topItems.map((item) => item.title).filter(Boolean).slice(0, 3);
  const topSources = [...new Set(topItems.map((item) => item.source).filter(Boolean))].slice(0, 3);
  const focus = titles.length
    ? `聚焦点：${titles[0]}`
    : `聚焦点：${CHANNEL_LABELS[channelId] || channelId}暂无足够新内容。`;
  const whyItMatters = topItems.length
    ? `重要性：这些信息来自${topSources.join("、") || "主要来源"}，集中体现本频道最新可观察变化。`
    : "重要性：当前没有足够新内容，暂不形成明确判断。";
  const watchlist = topItems.slice(0, 3).map((item) => `继续关注：${truncateText(item.title, 70)}`);
  const overview = titles.length
    ? `今日${CHANNEL_LABELS[channelId] || channelId}重点集中在：${titles.join("；")}。`
    : `今日${CHANNEL_LABELS[channelId] || channelId}暂无足够高价值信息形成总结。`;

  return {
    id: channelId,
    label: CHANNEL_LABELS[channelId] || channelId,
    overview: truncateText(overview, Number(rules.daily?.channelOverviewMaxLength || 260)),
    focus: truncateText(focus, Number(rules.daily?.focusMaxLength || 140)),
    whyItMatters: truncateText(whyItMatters, Number(rules.daily?.whyItMattersMaxLength || 180)),
    watchlist,
    keyPoints: topItems.slice(0, 3).map((item) => truncateText(item.aiSummary || item.contentExcerpt || item.summary || item.title, 120)),
    highlights: topItems.map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      source: item.source,
      score: item.score,
      summary: truncateText(item.aiSummary || item.contentExcerpt || item.summary || "", 180)
    }))
  };
}

function buildDailyBriefPrompt(summaryItems, rules = {}) {
  return [
    "Create a daily important-affairs summary for a public dashboard.",
    "Cover only three areas: tech, finance, news.",
    "Return minified valid JSON only. Do not wrap it in markdown.",
    "Do not include line breaks inside JSON string values.",
    "Use exactly this shape: {\"channelSummaries\":{\"tech\":{\"overview\":\"...\",\"focus\":\"...\",\"whyItMatters\":\"...\",\"keyPoints\":[\"...\"],\"watchlist\":[\"...\"]},\"finance\":{\"overview\":\"...\",\"focus\":\"...\",\"whyItMatters\":\"...\",\"keyPoints\":[\"...\"],\"watchlist\":[\"...\"]},\"news\":{\"overview\":\"...\",\"focus\":\"...\",\"whyItMatters\":\"...\",\"keyPoints\":[\"...\"],\"watchlist\":[\"...\"]}}}.",
    "Use only the provided items. Explain the concrete focus, why it matters, and what to keep watching. Keep each overview under 120 Chinese characters. Use at most three keyPoints and three watchlist items per channel.",
    "",
    JSON.stringify({
      channels: DEFAULT_CHANNELS.map((channel) => ({
        id: channel,
        label: CHANNEL_LABELS[channel],
        items: sortItems(summaryItems.filter((item) => item.category === channel)).slice(0, Number(rules.daily?.maxHighlightsPerChannel || 5)).map((item) => ({
          title: item.title,
          source: item.source,
          score: item.score,
          summary: item.aiSummary || item.contentExcerpt || item.summary || "",
          publishedAt: item.publishedAt
        }))
      }))
    }, null, 2)
  ].join("\n");
}

function applyDailyBriefResponse(fallbackSummaries, responseJson, rules = {}) {
  const response = responseJson.channelSummaries || {};
  return fallbackSummaries.map((channel) => {
    const modelChannel = response[channel.id] || {};
    return {
      ...channel,
      overview: truncateText(modelChannel.overview || channel.overview, Number(rules.daily?.channelOverviewMaxLength || 260)),
      focus: truncateText(modelChannel.focus || channel.focus || "", Number(rules.daily?.focusMaxLength || 140)),
      whyItMatters: truncateText(modelChannel.whyItMatters || channel.whyItMatters || "", Number(rules.daily?.whyItMattersMaxLength || 180)),
      keyPoints: Array.isArray(modelChannel.keyPoints)
        ? modelChannel.keyPoints.slice(0, 5).map((point) => truncateText(point, 120)).filter(Boolean)
        : channel.keyPoints,
      watchlist: Array.isArray(modelChannel.watchlist)
        ? modelChannel.watchlist.slice(0, 3).map((point) => truncateText(point, 100)).filter(Boolean)
        : channel.watchlist,
      summaryMethod: getLlmConfig(rules).provider
    };
  });
}

async function buildDailyChannelSummaries(summaryItems, rules = {}, options = {}) {
  const fallbackSummaries = DEFAULT_CHANNELS.map((channel) => (
    buildExtractiveChannelSummary(channel, summaryItems.filter((item) => item.category === channel), rules)
  ));
  const env = options.env || process.env;
  if (!isLlmConfigured(rules, env)) {
    return {
      channels: fallbackSummaries.map((channel) => ({ ...channel, summaryMethod: rules.method || "extractive" })),
      stats: {
        llmAttempted: 0,
        llmSucceeded: 0,
        fallbackCount: rules.llmProduction?.enabled ? 1 : 0,
        errorCount: 0
      }
    };
  }

  try {
    const responseJson = await requestDeepSeekJson(buildDailyBriefPrompt(summaryItems, rules), rules, options);
    return {
      channels: applyDailyBriefResponse(fallbackSummaries, responseJson, rules),
      stats: {
        llmAttempted: 1,
        llmSucceeded: 1,
        fallbackCount: 0,
        errorCount: 0
      }
    };
  } catch (error) {
    return {
      channels: fallbackSummaries.map((channel) => ({ ...channel, summaryMethod: rules.method || "extractive" })),
      stats: {
        llmAttempted: 1,
        llmSucceeded: 0,
        fallbackCount: 1,
        errorCount: 1
      },
      errors: [{ message: truncateText(error.message, 180) }]
    };
  }
}

async function buildDailySummaryOutput(summarized, rules, nowIso, options = {}) {
  const summaryItems = summarized.items.filter((item) => item.aiSummary);
  const dailyBrief = await buildDailyChannelSummaries(summaryItems, rules, options);
  const itemFallbackCount = Number(summarized.summaryStats?.fallbackCount || 0);
  const itemErrorCount = Number(summarized.summaryStats?.errorCount || 0);
  const briefFallbackCount = Number(dailyBrief.stats?.fallbackCount || 0);
  const briefErrorCount = Number(dailyBrief.stats?.errorCount || 0);

  return {
    generatedAt: nowIso,
    method: dailyBrief.stats?.llmSucceeded > 0 ? getLlmConfig(rules).provider : summarized.summaryMethod,
    llmProvider: getLlmConfig(rules).provider,
    llmEnabled: Boolean(rules.llmProduction?.enabled),
    llmConfigured: Boolean(summarized.summaryStats?.llmConfigured),
    fallbackCount: itemFallbackCount + briefFallbackCount,
    errorCount: itemErrorCount + briefErrorCount,
    summaryShape: "channel-daily-brief",
    channelSummaries: dailyBrief.channels,
    ...(summarized.summaryErrors || dailyBrief.errors ? { errors: [...(summarized.summaryErrors || []), ...(dailyBrief.errors || [])] } : {}),
    totalSummaries: dailyBrief.channels.length,
    items: summaryItems.map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      source: item.source,
      sourceId: item.sourceId,
      category: item.category,
      publishedAt: item.publishedAt,
      score: item.score,
      aiSummary: item.aiSummary,
      summary_short: item.summary_short,
      summary_points: item.summary_points,
      key_data: item.key_data,
      what_happened: item.what_happened,
      confirmed_facts: item.confirmed_facts,
      what_changed: item.what_changed,
      impact_analysis: item.impact_analysis,
      uncertainties: item.uncertainties,
      watch_variables: item.watch_variables,
      tracking_decision: item.tracking_decision,
      confidence_level: item.confidence_level,
      source_links: item.source_links,
      why_it_matters: item.why_it_matters,
      impact: item.impact,
      risks: item.risks,
      neutrality_check: item.neutrality_check,
      confidence: item.confidence,
      importance_score: item.importance_score,
      timeline_event_id: item.timeline_event_id,
      original_url: item.original_url,
      ai_model: item.ai_model,
      ai_generated_at: item.ai_generated_at,
      summaryReason: item.summaryReason,
      translatedTitle: item.translatedTitle,
      importance: item.importance,
      impactAreas: item.impactAreas,
      summaryMethod: item.summaryMethod
    }))
  };
}

async function generateAiSummary(nowIso = new Date().toISOString(), options = {}) {
  const latestPath = path.join(ROOT_DIR, "src", "data", "latest-items.json");
  const rules = readJson(path.join(ROOT_DIR, "config", "ai-summary-rules.json"), {});
  const latest = readJson(latestPath, { items: [], channels: {} });
  const summarized = await summarizeLatestDataWithLlm(latest, rules, nowIso, options);
  const output = await buildDailySummaryOutput(summarized, rules, nowIso, options);

  writeJson(latestPath, summarized);
  writeJson(path.join(ROOT_DIR, "src", "data", "daily-summary.json"), output);
  writeJson(path.join(ROOT_DIR, "data", "processed", "ai-summaries.json"), output);
  return output;
}

async function generateArticleSummaries(nowIso = new Date().toISOString(), options = {}) {
  const latestPath = path.join(ROOT_DIR, "src", "data", "latest-items.json");
  const rules = readJson(path.join(ROOT_DIR, "config", "ai-summary-rules.json"), {});
  const latest = readJson(latestPath, { items: [], channels: {} });
  const summarized = await summarizeLatestDataWithLlm(latest, rules, nowIso, options);

  writeJson(latestPath, summarized);
  return summarized.summaryStats || {};
}

async function generateDailyBrief(nowIso = new Date().toISOString(), options = {}) {
  const latestPath = path.join(ROOT_DIR, "src", "data", "latest-items.json");
  const rules = readJson(path.join(ROOT_DIR, "config", "ai-summary-rules.json"), {});
  const latest = readJson(latestPath, { items: [], channels: {} });
  const output = await buildDailySummaryOutput(latest, rules, nowIso, options);

  writeJson(path.join(ROOT_DIR, "src", "data", "daily-summary.json"), output);
  writeJson(path.join(ROOT_DIR, "data", "processed", "ai-summaries.json"), output);
  return output;
}

if (require.main === module) {
  loadLocalEnv(ROOT_DIR);
  const mode = process.argv[2] || "--all";
  const runner = mode === "--items-only"
    ? generateArticleSummaries
    : mode === "--daily-brief-only"
      ? generateDailyBrief
      : generateAiSummary;

  runner()
    .then((output) => {
      if (mode === "--items-only") {
        console.log(`Generated article AI summaries. LLM attempts: ${output.llmAttempted || 0}; succeeded: ${output.llmSucceeded || 0}.`);
        return;
      }
      console.log(`Generated ${output.totalSummaries} daily summaries with ${output.method} method.`);
      if (output.fallbackCount > 0) {
        console.log(`Fallback summaries: ${output.fallbackCount}; API errors: ${output.errorCount}.`);
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  detectItemLanguage,
  isLikelyEnglishItem,
  needsChineseTranslation,
  hasRequiredChineseTranslation,
  splitSentences,
  summarizeText,
  buildReason,
  buildImportance,
  buildItemSummaryRules,
  getLlmConfig,
  isLlmConfigured,
  buildSummaryPrompt,
  buildDailyBriefPrompt,
  buildDeepSeekRequestBody,
  extractChatCompletionText,
  selectSummaryIds,
  parseSummaryResponse,
  requestDeepSeekSummary,
  applyLlmSummary,
  buildDailyChannelSummaries,
  summarizeLatestData,
  summarizeLatestDataWithLlm,
  buildDailySummaryOutput,
  generateAiSummary,
  generateArticleSummaries,
  generateDailyBrief
};
