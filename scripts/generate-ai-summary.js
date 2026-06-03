const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");
const { normalizeText, sortItems, truncateText } = require("./lib/pipeline");
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

function shouldSummarize(item, rules) {
  return Number(item.score || 0) >= Number(rules.minimumScore || 0)
    && Boolean(item.title)
    && Boolean(item.url)
    && Boolean(item.contentExcerpt || item.summary);
}

function selectSummaryIds(latestData, dailyRules = {}) {
  const maxItemsPerChannel = Number(dailyRules.maxItemsPerChannel || 20);
  const selectedIds = new Set();

  DEFAULT_CHANNELS.forEach((channel) => {
    sortItems((latestData.items || []).filter((item) => item.category === channel && shouldSummarize(item, dailyRules)))
      .slice(0, maxItemsPerChannel)
      .forEach((item) => selectedIds.add(item.id));
  });

  return selectedIds;
}

function mergeItemsIntoChannels(latestData, items) {
  return Object.fromEntries(Object.entries(latestData.channels || {}).map(([id, channel]) => {
    const channelItems = (channel.items || []).map((item) => items.find((candidate) => candidate.id === item.id) || item);
    return [id, { ...channel, items: channelItems }];
  }));
}

function applyExtractiveSummary(item, rules, generatedAt) {
  return {
    ...item,
    aiSummary: summarizeText(item, rules.summaryMaxLength),
    summaryReason: buildReason(item, rules.reasonMaxLength),
    summaryMethod: "extractive",
    summaryGeneratedAt: generatedAt
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
    "Enrich this item for a Chinese daily tech/finance/news dashboard.",
    `Output limits: aiSummary <= ${summaryMaxLength} Chinese characters; summaryReason <= ${reasonMaxLength} Chinese characters; displaySummary <= ${summaryMaxLength} Chinese characters.`,
    "If the title or excerpt is English, translate the title and summary into natural Chinese. If it is already Chinese, keep the title meaning unchanged.",
    "Return JSON only with keys: aiSummary, summaryReason, displayTitle, displaySummary, refinedTags, impactAreas, language.",
    "refinedTags must use only concrete tags such as AI芯片, AI模型, 云计算, 网络安全, 美联储, 央行, 财报, 市场监管, 地缘政治, 国际组织, 财政政策, 宏观数据, 消费电子, 开发者平台.",
    "impactAreas must use short Chinese areas such as 科技, 金融, 宏观, 国际, 政策, 商业, 消费, 公共事务.",
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
  const refinedTags = Array.isArray(responseJson.refinedTags)
    ? responseJson.refinedTags.map(normalizeText).filter(Boolean).slice(0, 5)
    : [];
  const impactAreas = Array.isArray(responseJson.impactAreas)
    ? responseJson.impactAreas.map(normalizeText).filter(Boolean).slice(0, 3)
    : [];
  const language = ["en", "zh", "unknown"].includes(responseJson.language) ? responseJson.language : undefined;

  return {
    aiSummary: truncateText(responseJson.aiSummary || summarizeText(item, dailyRules.summaryMaxLength), dailyRules.summaryMaxLength || 180),
    summaryReason: truncateText(responseJson.summaryReason || buildReason(item, dailyRules.reasonMaxLength), dailyRules.reasonMaxLength || 120),
    ...(responseJson.displayTitle ? { displayTitle: truncateText(responseJson.displayTitle, 120) } : {}),
    ...(responseJson.displaySummary ? { displaySummary: truncateText(responseJson.displaySummary, dailyRules.summaryMaxLength || 180) } : {}),
    ...(refinedTags.length ? { refinedTags } : {}),
    ...(impactAreas.length ? { impactAreas } : {}),
    ...(language ? { language } : {})
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

    const fallback = applyExtractiveSummary(item, dailyRules, generatedAt);
    if (!llmConfigured) {
      items.push(fallback);
      continue;
    }

    stats.llmAttempted += 1;
    try {
      const modelSummary = await requestDeepSeekSummary(item, rules, options);
      items.push({
        ...fallback,
        ...modelSummary,
        originalTitle: item.originalTitle || item.title,
        originalSummary: item.originalSummary || item.summary || item.contentExcerpt || "",
        summaryMethod: getLlmConfig(rules).provider,
        translationMethod: modelSummary.displayTitle ? getLlmConfig(rules).provider : "fallback-original",
        summaryGeneratedAt: generatedAt
      });
      stats.llmSucceeded += 1;
    } catch (error) {
      items.push(fallback);
      stats.fallbackCount += 1;
      stats.errorCount += 1;
      errors.push({
        id: item.id,
        message: truncateText(error.message, 180)
      });
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
  splitSentences,
  summarizeText,
  buildReason,
  getLlmConfig,
  isLlmConfigured,
  buildSummaryPrompt,
  buildDailyBriefPrompt,
  buildDeepSeekRequestBody,
  extractChatCompletionText,
  parseSummaryResponse,
  requestDeepSeekSummary,
  buildDailyChannelSummaries,
  summarizeLatestData,
  summarizeLatestDataWithLlm,
  buildDailySummaryOutput,
  generateAiSummary
};
