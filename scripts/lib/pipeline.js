const crypto = require("node:crypto");

const DEFAULT_FETCHED_AT = () => new Date().toISOString();
const PUBLISHED_SUMMARY_LIMIT = 500;
const CONTENT_EXCERPT_LIMIT = 500;

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

  if (Number(rules.maxAgeDays || 0) > 0 && item.publishedAt) {
    const ageMs = Date.now() - new Date(item.publishedAt).getTime();
    if (ageMs > Number(rules.maxAgeDays) * 24 * 60 * 60 * 1000) {
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

function buildPublishedItem(item) {
  const summary = String(item.summary || "");
  const publishedSummary = summary.length > PUBLISHED_SUMMARY_LIMIT
    ? `${summary.slice(0, PUBLISHED_SUMMARY_LIMIT - 3).trimEnd()}...`
    : summary;
  const contentExcerpt = truncateText(item.contentExcerpt || "", CONTENT_EXCERPT_LIMIT);
  const imageUrl = normalizeImageUrl(item.imageUrl || "");

  return {
    id: item.id,
    sourceId: item.sourceId,
    title: item.title,
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
    ...(contentExcerpt ? { contentExcerpt } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    tags: (item.tags || []).slice(0, 8),
    score: item.score,
    duplicateCount: Number(item.duplicateCount || 0)
  };
}

function buildLatestData(items, siteConfig = {}, generatedAt = DEFAULT_FETCHED_AT()) {
  const defaultLimit = Number(siteConfig.defaultLimit || 12);
  const channels = {};
  const sortedItems = sortItems(items).map(buildPublishedItem);
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
  buildLatestData
};
