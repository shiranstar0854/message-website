const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");
const { normalizeText, sortItems, truncateText } = require("./lib/pipeline");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_CHANNELS = ["tech", "finance", "news"];

function splitSentences(text) {
  return normalizeText(text)
    .split(/(?<=[。！？.!?])\s+|(?<=[。！？.!?])/)
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

function summarizeLatestData(latestData, rules = {}, generatedAt = new Date().toISOString()) {
  const dailyRules = rules.daily || {};
  const maxItemsPerChannel = Number(dailyRules.maxItemsPerChannel || 20);
  const summaryMaxLength = Number(dailyRules.summaryMaxLength || 180);
  const reasonMaxLength = Number(dailyRules.reasonMaxLength || 120);
  const selectedIds = new Set();

  DEFAULT_CHANNELS.forEach((channel) => {
    sortItems((latestData.items || []).filter((item) => item.category === channel && shouldSummarize(item, dailyRules)))
      .slice(0, maxItemsPerChannel)
      .forEach((item) => selectedIds.add(item.id));
  });

  const items = (latestData.items || []).map((item) => {
    if (!selectedIds.has(item.id)) return item;
    return {
      ...item,
      aiSummary: summarizeText(item, summaryMaxLength),
      summaryReason: buildReason(item, reasonMaxLength),
      summaryMethod: rules.method || "extractive",
      summaryGeneratedAt: generatedAt
    };
  });

  const channels = Object.fromEntries(Object.entries(latestData.channels || {}).map(([id, channel]) => {
    const channelItems = (channel.items || []).map((item) => items.find((candidate) => candidate.id === item.id) || item);
    return [id, { ...channel, items: channelItems }];
  }));

  return {
    ...latestData,
    generatedAt: latestData.generatedAt || generatedAt,
    summaryGeneratedAt: generatedAt,
    summaryMethod: rules.method || "extractive",
    channels,
    items
  };
}

function generateAiSummary(nowIso = new Date().toISOString()) {
  const latestPath = path.join(ROOT_DIR, "src", "data", "latest-items.json");
  const rules = readJson(path.join(ROOT_DIR, "config", "ai-summary-rules.json"), {});
  const latest = readJson(latestPath, { items: [], channels: {} });
  const summarized = summarizeLatestData(latest, rules, nowIso);
  const summaryItems = summarized.items.filter((item) => item.aiSummary);
  const output = {
    generatedAt: nowIso,
    method: summarized.summaryMethod,
    totalSummaries: summaryItems.length,
    items: summaryItems.map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      source: item.source,
      sourceId: item.sourceId,
      category: item.category,
      score: item.score,
      aiSummary: item.aiSummary,
      summaryReason: item.summaryReason,
      summaryMethod: item.summaryMethod
    }))
  };

  writeJson(latestPath, summarized);
  writeJson(path.join(ROOT_DIR, "data", "processed", "ai-summaries.json"), output);
  return output;
}

if (require.main === module) {
  const output = generateAiSummary();
  console.log(`Generated ${output.totalSummaries} daily summaries with ${output.method} method.`);
}

module.exports = {
  splitSentences,
  summarizeText,
  buildReason,
  summarizeLatestData,
  generateAiSummary
};
