const fs = require("node:fs");
const path = require("node:path");
const { readJson, readSources, writeJson } = require("./lib/file-utils");
const { sortItems, truncateText } = require("./lib/pipeline");
const {
  getLlmConfig,
  isLlmConfigured,
  requestDeepSeekJson
} = require("./lib/deepseek-summary-client");

const ROOT_DIR = path.resolve(__dirname, "..");
const CHANNEL_LABELS = {
  tech: "科技",
  finance: "金融",
  news: "新闻"
};

function isoWeekId(date) {
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((current - yearStart) / 86400000) + 1) / 7);
  return `${current.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function loadDailyArchives(lookbackDays, now = new Date()) {
  const directory = path.join(ROOT_DIR, "data", "archive", "daily");
  if (!fs.existsSync(directory)) return [];
  const earliest = new Date(now.getTime() - Number(lookbackDays || 7) * 24 * 60 * 60 * 1000);

  return fs.readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readJson(path.join(directory, file), null))
    .filter(Boolean)
    .filter((archive) => {
      const generatedAt = new Date(archive.generatedAt || archive.date || 0);
      return !Number.isNaN(generatedAt.getTime()) && generatedAt >= earliest && generatedAt <= now;
    })
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));
}

function countSources(items) {
  const counts = items.reduce((result, item) => {
    result[item.source] = (result[item.source] || 0) + 1;
    return result;
  }, {});
  return Object.entries(counts)
    .sort((left, right) => Number(right[1]) - Number(left[1]) || left[0].localeCompare(right[0]))
    .map(([source, count]) => ({ source, count }));
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.url || item.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterEnabledSourceItems(items, sources) {
  const enabled = sources.filter((source) => source.enabled !== false);
  const enabledIds = new Set(enabled.map((source) => source.id));
  const enabledNames = new Set(enabled.map((source) => source.name));

  return items.filter((item) => enabledIds.has(item.sourceId) || enabledNames.has(item.source));
}

function buildChannelReview(category, items, rules) {
  const channelItems = uniqueItems(items.filter((item) => item.category === category));
  const sorted = sortItems(channelItems);
  const highlights = sorted.slice(0, Number(rules.maxHighlightsPerChannel || 8)).map((item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    source: item.source,
    score: item.score,
    summary: truncateText(item.aiSummary || item.contentExcerpt || item.summary || "", 220),
    publishedAt: item.publishedAt
  }));

  return {
    id: category,
    label: CHANNEL_LABELS[category] || category,
    totalItems: channelItems.length,
    topSources: countSources(channelItems).slice(0, Number(rules.maxSourcesPerChannel || 6)),
    highlights,
    themes: highlights.slice(0, 5).map((item) => truncateText(item.title, 80))
  };
}

function buildWeeklyReview(archives, rules = {}, nowIso = new Date().toISOString()) {
  const items = archives.flatMap((archive) => archive.items || []);
  const generatedAt = nowIso;
  const weekId = isoWeekId(new Date(nowIso));

  return {
    weekId,
    generatedAt,
    method: "extractive",
    archiveDays: archives.map((archive) => archive.date),
    totals: {
      archiveCount: archives.length,
      itemCount: items.length
    },
    channels: ["tech", "finance", "news"].map((category) => buildChannelReview(category, items, rules.weekly || {}))
  };
}

function buildWeeklyPrompt(review, rules = {}) {
  return [
    "Create a weekly review for a public tech/finance/news dashboard.",
    "Return JSON only with keys: executiveSummary, channelReviews.",
    "channelReviews must be an object keyed by tech, finance, news. Each value must include summary and watchlist.",
    "Use only the provided highlights and source counts.",
    "",
    JSON.stringify({
      weekId: review.weekId,
      archiveDays: review.archiveDays,
      totals: review.totals,
      channels: review.channels.map((channel) => ({
        id: channel.id,
        label: channel.label,
        totalItems: channel.totalItems,
        topSources: channel.topSources,
        highlights: (channel.highlights || []).slice(0, Number(rules.weekly?.maxHighlightsPerChannel || 8))
      }))
    }, null, 2)
  ].join("\n");
}

function applyWeeklyLlmResponse(review, responseJson, rules = {}, generatedAt = new Date().toISOString()) {
  const weeklyRules = rules.weekly || {};
  const channelReviews = responseJson.channelReviews || {};
  return {
    ...review,
    method: getLlmConfig(rules).provider,
    modelSummary: truncateText(responseJson.executiveSummary || "", Number(weeklyRules.executiveSummaryMaxLength || 600)),
    channels: review.channels.map((channel) => {
      const modelReview = channelReviews[channel.id] || {};
      return {
        ...channel,
        modelSummary: truncateText(modelReview.summary || "", Number(weeklyRules.channelSummaryMaxLength || 360)),
        watchlist: Array.isArray(modelReview.watchlist)
          ? modelReview.watchlist.slice(0, 5).map((item) => truncateText(item, 90)).filter(Boolean)
          : []
      };
    }),
    summaryStats: {
      llmEnabled: Boolean(rules.llmProduction?.enabled),
      llmConfigured: true,
      llmAttempted: 1,
      llmSucceeded: 1,
      fallbackCount: 0,
      errorCount: 0,
      generatedAt
    }
  };
}

async function enhanceWeeklyReviewWithLlm(review, rules = {}, generatedAt = new Date().toISOString(), options = {}) {
  const env = options.env || process.env;
  const llmConfigured = isLlmConfigured(rules, env);
  if (!llmConfigured) {
    return {
      ...review,
      summaryStats: {
        llmEnabled: Boolean(rules.llmProduction?.enabled),
        llmConfigured: false,
        llmAttempted: 0,
        llmSucceeded: 0,
        fallbackCount: rules.llmProduction?.enabled ? 1 : 0,
        errorCount: 0,
        generatedAt
      }
    };
  }

  try {
    const responseJson = await requestDeepSeekJson(buildWeeklyPrompt(review, rules), rules, options);
    return applyWeeklyLlmResponse(review, responseJson, rules, generatedAt);
  } catch (error) {
    return {
      ...review,
      summaryStats: {
        llmEnabled: Boolean(rules.llmProduction?.enabled),
        llmConfigured: true,
        llmAttempted: 1,
        llmSucceeded: 0,
        fallbackCount: 1,
        errorCount: 1,
        generatedAt
      },
      summaryErrors: [{ message: truncateText(error.message, 180) }]
    };
  }
}

async function generateWeeklyReview(nowIso = new Date().toISOString(), options = {}) {
  const rules = readJson(path.join(ROOT_DIR, "config", "ai-summary-rules.json"), {});
  const archives = loadDailyArchives(rules.weekly?.lookbackDays || 7, new Date(nowIso));
  const sources = readSources(ROOT_DIR);
  const filteredArchives = archives.map((archive) => ({
    ...archive,
    items: filterEnabledSourceItems(archive.items || [], sources)
  }));
  const review = await enhanceWeeklyReviewWithLlm(buildWeeklyReview(filteredArchives, rules, nowIso), rules, nowIso, options);
  writeJson(path.join(ROOT_DIR, "src", "data", "weekly-review.json"), review);
  writeJson(path.join(ROOT_DIR, "data", "archive", "weekly", `${review.weekId}.json`), review);
  return review;
}

if (require.main === module) {
  generateWeeklyReview()
    .then((review) => {
      console.log(`Generated weekly review ${review.weekId} from ${review.totals.archiveCount} daily archives.`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  isoWeekId,
  loadDailyArchives,
  buildWeeklyReview,
  buildWeeklyPrompt,
  enhanceWeeklyReviewWithLlm,
  filterEnabledSourceItems,
  generateWeeklyReview
};
