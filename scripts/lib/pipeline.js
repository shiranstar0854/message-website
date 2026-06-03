const crypto = require("node:crypto");

const DEFAULT_FETCHED_AT = () => new Date().toISOString();
const PUBLISHED_SUMMARY_LIMIT = 500;
const CONTENT_EXCERPT_LIMIT = 500;
const DISPLAY_SUMMARY_LIMIT = 180;
const HOTSPOT_LIMIT = 5;

const TOPIC_TAXONOMY = [
  { label: "AI芯片", terms: ["ai chip", "gpu", "nvidia", "芯片", "算力", "半导体"], impactAreas: ["科技", "资本市场"] },
  { label: "AI模型", terms: ["ai model", "llm", "large language model", "openai", "gemini", "模型", "人工智能"], impactAreas: ["科技", "产业"] },
  { label: "云计算", terms: ["cloud", "azure", "aws", "google cloud", "云计算", "数据中心"], impactAreas: ["科技", "企业服务"] },
  { label: "网络安全", terms: ["security", "cyber", "cisa", "breach", "vulnerability", "网络安全", "漏洞"], impactAreas: ["科技", "公共安全"] },
  { label: "美联储", terms: ["federal reserve", "fed", "fomc", "美联储"], impactAreas: ["金融", "宏观"] },
  { label: "央行", terms: ["central bank", "pbc", "人民银行", "央行", "货币政策"], impactAreas: ["金融", "宏观"] },
  { label: "财报", terms: ["earnings", "revenue", "profit", "财报", "营收", "利润"], impactAreas: ["资本市场", "商业"] },
  { label: "市场监管", terms: ["sec", "csrc", "regulation", "enforcement", "监管", "证监会", "执法"], impactAreas: ["金融", "政策"] },
  { label: "地缘政治", terms: ["sanction", "geopolitical", "war", "conflict", "地缘", "制裁", "冲突"], impactAreas: ["国际", "风险"] },
  { label: "国际组织", terms: ["un news", "united nations", "imf", "world bank", "联合国", "国际货币基金"], impactAreas: ["国际", "政策"] },
  { label: "财政政策", terms: ["fiscal", "treasury", "budget", "财政", "国债", "预算", "补贴"], impactAreas: ["宏观", "政策"] },
  { label: "宏观数据", terms: ["inflation", "pmi", "gdp", "cpi", "statistics", "统计", "通胀", "采购经理"], impactAreas: ["宏观", "金融"] },
  { label: "消费电子", terms: ["iphone", "android", "device", "consumer electronics", "消费电子", "手机"], impactAreas: ["科技", "消费"] },
  { label: "开发者平台", terms: ["developer", "github", "api", "sdk", "开发者", "平台"], impactAreas: ["科技", "开发者"] }
];

function normalizeText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return normalizeText(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 44) || "item";
}

function hashText(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 10);
}

function normalizeUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(String(value).trim());
    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }
    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "ref_src",
      "cmpid"
    ].forEach((param) => url.searchParams.delete(param));
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function normalizeImageUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(String(value).trim());
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function truncateText(value, limit = CONTENT_EXCERPT_LIMIT) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function textIncludesTerm(text, term) {
  const normalizedText = String(text || "").toLowerCase();
  const normalizedTerm = String(term || "").toLowerCase();
  return Boolean(normalizedTerm && normalizedText.includes(normalizedTerm));
}

function inferRefinedTags(item, taxonomy = TOPIC_TAXONOMY, limit = 5) {
  const haystack = normalizeText([
    item.title,
    item.displayTitle,
    item.summary,
    item.aiSummary,
    item.contentExcerpt,
    ...(item.tags || [])
  ].filter(Boolean).join(" "));
  const matched = taxonomy
    .filter((topic) => (topic.terms || []).some((term) => textIncludesTerm(haystack, term)))
    .map((topic) => topic.label);
  const existing = (item.refinedTags || []).filter(Boolean);
  return [...new Set([...existing, ...matched])].slice(0, limit);
}

function inferImpactAreas(item, refinedTags = inferRefinedTags(item), taxonomy = TOPIC_TAXONOMY, limit = 3) {
  const explicit = (item.impactAreas || []).filter(Boolean);
  const taxonomyAreas = refinedTags.flatMap((tag) => {
    const topic = taxonomy.find((entry) => entry.label === tag);
    return topic?.impactAreas || [];
  });
  const categoryAreas = {
    tech: ["科技"],
    finance: ["金融"],
    news: ["公共事务"]
  }[item.category] || [];
  return [...new Set([...explicit, ...taxonomyAreas, ...categoryAreas])].slice(0, limit);
}

function detectItemLanguage(item) {
  const text = normalizeText([item.title, item.summary, item.contentExcerpt].filter(Boolean).join(" "));
  if (!text) return "unknown";
  const latinWords = text.match(/[A-Za-z]{3,}/g) || [];
  const cjkChars = text.match(/[\u4e00-\u9fff]/g) || [];
  return latinWords.length >= 4 && latinWords.length > cjkChars.length ? "en" : "zh";
}

function calculateHotspotScore(item, nowIso = DEFAULT_FETCHED_AT()) {
  const base = Number(item.score || 0);
  const officialBoost = ["official-agency", "official-market", "official-media"].includes(item.sourceAuthority) ? 8 : 0;
  const duplicateBoost = Math.min(12, Number(item.duplicateCount || 0) * 3);
  const tagBoost = Math.min(10, (item.refinedTags || []).length * 2);
  const publishedTime = new Date(item.publishedAt || nowIso).getTime();
  const nowTime = new Date(nowIso).getTime();
  const ageHours = Number.isNaN(publishedTime) || Number.isNaN(nowTime)
    ? 72
    : Math.max(0, (nowTime - publishedTime) / (60 * 60 * 1000));
  const freshnessBoost = Math.max(0, 10 - Math.floor(ageHours / 12));
  return Math.round(base + officialBoost + duplicateBoost + tagBoost + freshnessBoost);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function normalizeDate(value, fallback) {
  const candidate = firstDefined(value, fallback);
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeRawItem(rawItem, fetchedAt = DEFAULT_FETCHED_AT(), sourceDefaults = {}) {
  const raw = rawItem.item || rawItem.record || rawItem;
  const sourceId = firstDefined(rawItem.sourceId, raw.sourceId, sourceDefaults.id, "");
  const sourceName = firstDefined(rawItem.sourceName, raw.sourceName, raw.source, sourceDefaults.name, "Unknown Source");
  const sourceType = firstDefined(rawItem.sourceType, raw.sourceType, sourceDefaults.type, "rss");
  const category = firstDefined(rawItem.category, raw.category, sourceDefaults.category, "news");
  const credibility = Number(firstDefined(rawItem.credibility, raw.credibility, sourceDefaults.credibility, 70));
  const sourceAuthority = firstDefined(rawItem.sourceAuthority, raw.sourceAuthority, sourceDefaults.sourceAuthority, "media");
  const timelinessTier = firstDefined(rawItem.timelinessTier, raw.timelinessTier, sourceDefaults.timelinessTier, "daily");
  const sourceLastCheckedAt = firstDefined(rawItem.sourceLastCheckedAt, raw.sourceLastCheckedAt, rawItem.fetchedAt, fetchedAt);
  const title = decodeHtml(firstDefined(raw.title, raw.headline, raw.name, raw.guid, "Untitled item"));
  const rawUrl = firstDefined(raw.link, raw.url, raw.href, raw.guid, "");
  const url = normalizeUrl(typeof rawUrl === "object" ? rawUrl.href : rawUrl);
  const publishedAt = normalizeDate(firstDefined(
    raw.publishedAt,
    raw.published_at,
    raw.pubDate,
    raw.isoDate,
    raw.date,
    raw.published,
    raw.updated
  ), fetchedAt);
  const summary = decodeHtml(firstDefined(
    raw.summary,
    raw.contentSnippet,
    raw.description,
    raw.excerpt,
    raw.content,
    ""
  ));
  const contentExcerpt = truncateText(decodeHtml(firstDefined(
    raw.contentExcerpt,
    raw.content,
    raw.encoded,
    raw.description,
    raw.summary,
    raw.contentSnippet,
    ""
  )));
  const imageUrl = normalizeImageUrl(firstDefined(
    raw.imageUrl,
    raw.feedImageUrl,
    raw.mediaUrl,
    raw.thumbnail,
    raw.urlToImage,
    raw.enclosure?.url,
    ""
  ));
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map(normalizeText).filter(Boolean)
    : Array.isArray(raw.categories)
      ? raw.categories.map(normalizeText).filter(Boolean)
      : [];
  const id = [
    slugify(category),
    slugify(sourceName),
    hashText(`${title}|${url}|${publishedAt}`)
  ].join("-");

  return {
    id,
    sourceId: normalizeText(sourceId),
    title,
    url,
    source: normalizeText(sourceName),
    sourceType: normalizeText(sourceType).toLowerCase(),
    category: normalizeText(category).toLowerCase(),
    publishedAt,
    summary,
    ...(contentExcerpt ? { contentExcerpt } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    fetchedAt,
    sourceLastCheckedAt,
    credibility: Number.isFinite(credibility) ? credibility : 70,
    sourceAuthority: normalizeText(sourceAuthority).toLowerCase(),
    timelinessTier: normalizeText(timelinessTier).toLowerCase(),
    tags,
    raw
  };
}

function getFilterReasons(item, rules = {}) {
  const reasons = [];
  const title = normalizeText(item.title);
  const source = normalizeText(item.source);
  const category = normalizeText(item.category).toLowerCase();
  const haystack = `${item.title || ""} ${item.summary || ""}`.toLowerCase();

  if (rules.requireUrl !== false && !item.url) {
    reasons.push("missing-url");
  }

  if (Array.isArray(rules.allowedCategories) && rules.allowedCategories.length > 0) {
    const allowed = rules.allowedCategories.map((value) => normalizeText(value).toLowerCase());
    if (!allowed.includes(category)) {
      reasons.push("category-not-allowed");
    }
  }

  if (Array.isArray(rules.blockedSources)) {
    const blocked = rules.blockedSources.map((value) => normalizeText(value).toLowerCase());
    if (blocked.includes(source.toLowerCase())) {
      reasons.push("blocked-source");
    }
  }

  if (Array.isArray(rules.blockedTerms)) {
    const blockedTerm = rules.blockedTerms.find((term) => haystack.includes(String(term).toLowerCase()));
    if (blockedTerm) {
      reasons.push(`blocked-term:${blockedTerm}`);
    }
  }

  if (Array.isArray(rules.lowValueTitlePatterns)) {
    const pattern = rules.lowValueTitlePatterns.find((term) => title.toLowerCase().includes(String(term).toLowerCase()));
    if (pattern) {
      reasons.push(`low-value-title:${pattern}`);
    }
  }

  if (Number(rules.minimumTitleLength || 0) > 0 && title.length < Number(rules.minimumTitleLength)) {
    reasons.push("title-too-short");
  }

  const maxAgeHours = Number(rules.maxAgeHours || 0) > 0
    ? Number(rules.maxAgeHours)
    : Number(rules.maxAgeDays || 0) * 24;
  if (maxAgeHours > 0 && item.publishedAt) {
    const nowTime = rules.nowIso ? new Date(rules.nowIso).getTime() : Date.now();
    const ageMs = nowTime - new Date(item.publishedAt).getTime();
    if (ageMs > maxAgeHours * 60 * 60 * 1000) {
      reasons.push("too-old");
    }
  }

  return reasons;
}

function filterItems(items, rules = {}) {
  return items
    .map((item) => ({ ...item, filterReasons: getFilterReasons(item, rules) }))
    .filter((item) => item.filterReasons.length === 0);
}

function titleTokens(title) {
  return new Set(
    normalizeText(title)
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/)
      .filter((token) => token.length > 1)
  );
}

function titleSimilarity(left, right) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function pickBestItem(items) {
  return [...items].sort((left, right) => {
    const credibilityDelta = Number(right.credibility || 0) - Number(left.credibility || 0);
    if (credibilityDelta !== 0) return credibilityDelta;
    return new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime();
  })[0];
}

function isDuplicateOfGroup(item, group, threshold) {
  const itemUrl = normalizeUrl(item.url);
  return group.some((candidate) => {
    const candidateUrl = normalizeUrl(candidate.url);
    if (itemUrl && candidateUrl && itemUrl === candidateUrl) return true;
    if (normalizeText(item.category).toLowerCase() !== normalizeText(candidate.category).toLowerCase()) return false;
    return titleSimilarity(item.title, candidate.title) >= threshold;
  });
}

function dedupeItems(items, rules = {}) {
  const threshold = Number(rules.titleSimilarityThreshold || 0.86);
  const groups = [];

  items.forEach((item) => {
    const group = groups.find((candidateGroup) => isDuplicateOfGroup(item, candidateGroup, threshold));
    if (group) {
      group.push(item);
    } else {
      groups.push([item]);
    }
  });

  return groups.map((group) => {
    const best = pickBestItem(group);
    const duplicates = group
      .filter((item) => item.id !== best.id)
      .map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        source: item.source,
        publishedAt: item.publishedAt
      }));
    return {
      ...best,
      duplicates,
      duplicateCount: duplicates.length
    };
  });
}

function calculateFreshnessScore(publishedAt, freshness = {}, nowIso = DEFAULT_FETCHED_AT()) {
  const weight = Number(freshness.weight || 18);
  const halfLifeHours = Number(freshness.halfLifeHours || 96);
  const publishedTime = new Date(publishedAt || nowIso).getTime();
  const nowTime = new Date(nowIso).getTime();
  if (Number.isNaN(publishedTime) || Number.isNaN(nowTime)) return 0;

  const ageHours = Math.max(0, (nowTime - publishedTime) / (60 * 60 * 1000));
  return weight * Math.pow(0.5, ageHours / halfLifeHours);
}

function keywordScore(item, keywordWeights = {}) {
  const haystack = `${item.title || ""} ${item.summary || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
  return Object.values(keywordWeights).flat().reduce((total, entry) => {
    const term = String(entry.term || "").toLowerCase();
    if (!term) return total;
    return haystack.includes(term) ? total + Number(entry.score || 0) : total;
  }, 0);
}

function scoreItems(items, rules = {}, nowIso = DEFAULT_FETCHED_AT()) {
  const baseScore = Number(rules.baseScore || 35);
  const sourceCredibilityWeight = Number(rules.sourceCredibilityWeight || 0.35);
  const duplicatePenalty = Number(rules.duplicatePenalty || 3);
  const categoryBoosts = rules.categoryBoosts || {};
  const sourceBoosts = rules.sourceBoosts || {};
  const sourceAuthorityBoosts = rules.sourceAuthorityBoosts || {};
  const timelinessBoosts = rules.timelinessBoosts || {};
  const officialFreshnessWindowHours = Number(rules.officialFreshnessWindowHours || 24);

  return items.map((item) => {
    const credibilityScore = Number(item.credibility || 70) * sourceCredibilityWeight;
    const freshnessScore = calculateFreshnessScore(item.publishedAt, rules.freshness, nowIso);
    const keywords = keywordScore(item, rules.keywordWeights);
    const categoryBoost = Number(categoryBoosts[item.category] || 0);
    const sourceBoost = Number(sourceBoosts[item.source] || 0);
    const authorityBoost = Number(sourceAuthorityBoosts[item.sourceAuthority] || 0);
    const timelinessBoost = Number(timelinessBoosts[item.timelinessTier] || 0);
    const publishedTime = new Date(item.publishedAt || nowIso).getTime();
    const nowTime = new Date(nowIso).getTime();
    const ageHours = Number.isNaN(publishedTime) || Number.isNaN(nowTime)
      ? Number.POSITIVE_INFINITY
      : Math.max(0, (nowTime - publishedTime) / (60 * 60 * 1000));
    const officialFreshnessBoost = ["official-agency", "official-market"].includes(item.sourceAuthority)
      && ageHours <= officialFreshnessWindowHours
      ? Number(rules.officialFreshnessBoost || 0)
      : 0;
    const duplicatePenaltyScore = Number(item.duplicateCount || (item.duplicates || []).length || 0) * duplicatePenalty;
    const rawScore = baseScore + credibilityScore + freshnessScore + keywords + categoryBoost + sourceBoost
      + authorityBoost + timelinessBoost + officialFreshnessBoost - duplicatePenaltyScore;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    return {
      ...item,
      score,
      scoreBreakdown: {
        base: baseScore,
        credibility: Number(credibilityScore.toFixed(2)),
        freshness: Number(freshnessScore.toFixed(2)),
        keywords,
        categoryBoost,
        sourceBoost,
        authorityBoost,
        timelinessBoost,
        officialFreshnessBoost,
        duplicatePenalty: duplicatePenaltyScore
      }
    };
  });
}

function sortItems(items, sortBy = "score-desc") {
  return [...items].sort((left, right) => {
    if (sortBy === "time-desc") {
      return new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime();
    }

    if (sortBy === "time-asc") {
      return new Date(left.publishedAt || 0).getTime() - new Date(right.publishedAt || 0).getTime();
    }

    return Number(right.score || 0) - Number(left.score || 0)
      || new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime();
  });
}

function buildPublishedItem(item, generatedAt = DEFAULT_FETCHED_AT()) {
  const summary = String(item.summary || "");
  const publishedSummary = summary.length > PUBLISHED_SUMMARY_LIMIT
    ? `${summary.slice(0, PUBLISHED_SUMMARY_LIMIT - 3).trimEnd()}...`
    : summary;
  const contentExcerpt = truncateText(item.contentExcerpt || "", CONTENT_EXCERPT_LIMIT);
  const imageUrl = normalizeImageUrl(item.imageUrl || "");
  const language = item.language || detectItemLanguage(item);
  const refinedTags = inferRefinedTags(item);
  const impactAreas = inferImpactAreas(item, refinedTags);
  const fallbackSummary = item.aiSummary || contentExcerpt || publishedSummary;
  const displayTitle = normalizeText(item.displayTitle || item.translatedTitle || item.title);
  const displaySummary = truncateText(item.displaySummary || fallbackSummary, DISPLAY_SUMMARY_LIMIT);
  const hotspotScore = calculateHotspotScore({ ...item, refinedTags }, generatedAt);

  return {
    id: item.id,
    sourceId: item.sourceId,
    title: item.title,
    displayTitle,
    ...(language === "en" ? { originalTitle: item.originalTitle || item.title } : {}),
    url: item.url,
    source: item.source,
    sourceType: item.sourceType,
    category: item.category,
    publishedAt: item.publishedAt,
    fetchedAt: item.fetchedAt,
    sourceLastCheckedAt: item.sourceLastCheckedAt,
    sourceAuthority: item.sourceAuthority,
    timelinessTier: item.timelinessTier,
    summary: publishedSummary,
    ...(displaySummary ? { displaySummary } : {}),
    ...(language === "en" && publishedSummary ? { originalSummary: item.originalSummary || publishedSummary } : {}),
    ...(contentExcerpt ? { contentExcerpt } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    tags: (item.tags || []).slice(0, 8),
    refinedTags,
    impactAreas,
    language,
    translationMethod: item.translationMethod || (language === "en" ? "fallback-original" : "source-original"),
    hotspotScore,
    score: item.score,
    duplicateCount: Number(item.duplicateCount || 0)
  };
}

function buildTopHotspots(items, generatedAt = DEFAULT_FETCHED_AT(), limit = HOTSPOT_LIMIT) {
  return [...items]
    .filter((item) => item.url && item.displayTitle)
    .sort((left, right) => Number(right.hotspotScore || calculateHotspotScore(right, generatedAt))
      - Number(left.hotspotScore || calculateHotspotScore(left, generatedAt))
      || Number(right.score || 0) - Number(left.score || 0)
      || new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime())
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      title: item.title,
      displayTitle: item.displayTitle || item.title,
      displaySummary: item.displaySummary || item.summary || "",
      importance: Number(item.hotspotScore || calculateHotspotScore(item, generatedAt)),
      impactAreas: (item.impactAreas || []).slice(0, 3),
      source: item.source,
      publishedAt: item.publishedAt,
      score: item.score,
      url: item.url
    }));
}

function buildLatestData(items, siteConfig = {}, generatedAt = DEFAULT_FETCHED_AT()) {
  const defaultLimit = Number(siteConfig.defaultLimit || 12);
  const channels = {};
  const sortedItems = sortItems(items).map((item) => buildPublishedItem(item, generatedAt));
  const channelConfig = siteConfig.channels || [
    { id: "tech", label: "Technology" },
    { id: "finance", label: "Finance" },
    { id: "news", label: "News" }
  ];

  channelConfig.forEach((channel) => {
    const channelItems = sortedItems.filter((item) => item.category === channel.id);
    channels[channel.id] = {
      id: channel.id,
      label: channel.label,
      description: channel.description || "",
      count: channelItems.length,
      items: channelItems.slice(0, Number(channel.limit || defaultLimit))
    };
  });

  return {
    siteName: siteConfig.siteName || "Message Choose",
    generatedAt,
    defaultLimit,
    totalItems: sortedItems.length,
    topHotspots: buildTopHotspots(sortedItems, generatedAt),
    channels,
    items: sortedItems
  };
}

module.exports = {
  normalizeText,
  normalizeUrl,
  normalizeImageUrl,
  truncateText,
  normalizeRawItem,
  filterItems,
  titleSimilarity,
  dedupeItems,
  scoreItems,
  sortItems,
  buildPublishedItem,
  buildTopHotspots,
  buildLatestData,
  detectItemLanguage,
  inferRefinedTags,
  inferImpactAreas,
  calculateHotspotScore
};
