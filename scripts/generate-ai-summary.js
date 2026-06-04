const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");
const { extractPublishedKeywords, normalizeText, sortItems, truncateText } = require("./lib/pipeline");
const {
  getLlmConfig,
  isLlmConfigured,
  buildDeepSeekRequestBody,
  extractChatCompletionText,
  requestDeepSeekJson
} = require("./lib/deepseek-summary-client");

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

function isLikelyEnglishItem(item) {
  return detectItemLanguage(item) === "en";
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

function shouldSummarize(item, rules) {
  return Number(item.score || 0) >= Number(rules.minimumScore || 0)
    && Boolean(item.title)
    && Boolean(item.url)
    && Boolean(item.contentExcerpt || item.summary);
}

function selectSummaryIds(latestData, dailyRules = {}) {
  const maxItemsPerChannel = Number(dailyRules.maxItemsPerChannel || 20);
  const maxEnglishTranslationItems = Number(dailyRules.maxEnglishTranslationItems || 30);
  const selectedIds = new Set();

  DEFAULT_CHANNELS.forEach((channel) => {
    sortItems((latestData.items || []).filter((item) => item.category === channel && shouldSummarize(item, dailyRules)))
      .slice(0, maxItemsPerChannel)
      .forEach((item) => selectedIds.add(item.id));
  });

  sortItems((latestData.items || []).filter((item) => (
    isLikelyEnglishItem(item)
      && Boolean(item.title)
      && Boolean(item.url)
      && Boolean(item.contentExcerpt || item.summary)
      && Number(item.score || 0) >= Number(dailyRules.translateEnglishMinimumScore || 0)
  )))
    .slice(0, maxEnglishTranslationItems)
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
  const summarized = {
    ...item,
    aiSummary: summarizeText(item, rules.summaryMaxLength),
    summaryReason: buildReason(item, rules.reasonMaxLength),
    importance: buildImportance(item, rules.importanceMaxLength),
    sourceLanguage: detectItemLanguage(item),
    summaryMethod: "extractive",
    summaryGeneratedAt: generatedAt
  };
  return {
    ...summarized,
    keywords: extractPublishedKeywords(summarized)
  };
}

async function applyLlmSummary(item, rules, generatedAt, options = {}) {
  const summary = await requestDeepSeekSummary(item, rules, options);
  const summarized = {
    ...item,
    ...summary,
    sourceLanguage: detectItemLanguage(item),
    summaryLanguage: "zh",
    summaryMethod: getLlmConfig(rules).provider,
    summaryGeneratedAt: generatedAt
  };
  return {
    ...summarized,
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
  const summaryMaxLength = Number(dailyRules.summaryMaxLength || 180);
  const reasonMaxLength = Number(dailyRules.reasonMaxLength || 120);
  return [
    "Summarize this item for a daily tech/finance/news dashboard.",
    "Write aiSummary and summaryReason in concise Chinese.",
    "If the source material is primarily English, translate and summarize it into natural Chinese. Do not copy English sentences into aiSummary.",
    `Output limits: translatedTitle <= 50 Chinese characters; aiSummary <= ${summaryMaxLength} Chinese characters; summaryReason <= ${reasonMaxLength} Chinese characters; importance <= 80 Chinese characters.`,
    "Return JSON only with keys: translatedTitle, aiSummary, summaryReason, importance, impactAreas.",
    "impactAreas must be an array of 2 to 4 concise Chinese tags, for example: AI芯片, 美联储, 财报, 地缘政治, 消费电子.",
    "",
    JSON.stringify({
      title: item.title,
      source: item.source,
      category: item.category,
      score: item.score,
      tags: item.tags || [],
      url: item.url,
      publishedAt: item.publishedAt,
      excerpt: item.contentExcerpt || item.summary || ""
    }, null, 2)
  ].join("\n");
}

function parseSummaryResponse(responseJson, item, dailyRules = {}) {
  return {
    translatedTitle: truncateText(responseJson.translatedTitle || "", 120),
    aiSummary: truncateText(responseJson.aiSummary || summarizeText(item, dailyRules.summaryMaxLength), dailyRules.summaryMaxLength || 180),
    summaryReason: truncateText(responseJson.summaryReason || buildReason(item, dailyRules.reasonMaxLength), dailyRules.reasonMaxLength || 120),
    importance: truncateText(responseJson.importance || buildImportance(item, dailyRules.importanceMaxLength), dailyRules.importanceMaxLength || 140),
    impactAreas: Array.isArray(responseJson.impactAreas)
      ? responseJson.impactAreas.slice(0, 4).map((value) => truncateText(value, 20)).filter(Boolean)
      : []
  };
}

async function requestDeepSeekSummary(item, rules = {}, options = {}) {
  const responseJson = await requestDeepSeekJson(buildSummaryPrompt(item, rules.daily || {}), rules, options);
  return parseSummaryResponse(responseJson, item, rules.daily || {});
}

async function summarizeLatestDataWithLlm(latestData, rules = {}, generatedAt = new Date().toISOString(), options = {}) {
  const dailyRules = rules.daily || {};
  const selectedIds = selectSummaryIds(latestData, dailyRules);
  const env = options.env || process.env;
  const llmConfigured = isLlmConfigured(rules, env);
  const stats = {
    llmEnabled: Boolean(rules.llmProduction?.enabled),
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

    const fallbackItem = applyExtractiveSummary(item, dailyRules, generatedAt);
    if (!llmConfigured || !rules.llmProduction?.enabled) {
      items.push(fallbackItem);
      continue;
    }

    stats.llmAttempted += 1;
    try {
      const llmItem = await applyLlmSummary(item, rules, generatedAt, options);
      stats.llmSucceeded += 1;
      items.push(llmItem);
    } catch (error) {
      stats.fallbackCount += 1;
      stats.errorCount += 1;
      errors.push({ id: item.id, message: truncateText(error.message, 180) });
      items.push(fallbackItem);
    }
  }

  const channels = mergeItemsIntoChannels(latestData, items);

  return {
    ...latestData,
    generatedAt: latestData.generatedAt || generatedAt,
    summaryGeneratedAt: generatedAt,
    summaryMethod: rules.method || "extractive",
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

if (require.main === module) {
  generateAiSummary()
    .then((output) => {
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
  splitSentences,
  summarizeText,
  buildReason,
  buildImportance,
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
  generateAiSummary
};
