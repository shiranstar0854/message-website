const crypto = require("node:crypto");

const DEFAULT_FETCHED_AT = () => new Date().toISOString();
const PUBLISHED_SUMMARY_LIMIT = 500;
const CONTENT_EXCERPT_LIMIT = 500;
const KEYWORD_LIMIT = 8;
const ENGLISH_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "amid",
  "from",
  "have",
  "into",
  "more",
  "news",
  "over",
  "said",
  "says",
  "that",
  "their",
  "this",
  "with",
  "will",
  "your"
]);
const FINE_KEYWORD_RULES = [
  { label: "AI芯片", pattern: /(ai chip|gpu|nvidia|semiconductor|accelerator|芯片|算力|英伟达)/i },
  { label: "AI政策", pattern: /(ai policy|artificial intelligence|regulation|safety|governance|监管|安全)/i },
  { label: "美联储", pattern: /(federal reserve|fed\b|fomc|powell|美联储|联邦储备)/i },
  { label: "央行", pattern: /(central bank|人民银行|央行|利率|降息|加息)/i },
  { label: "财报", pattern: /(earnings|revenue|profit|guidance|quarter|财报|营收|利润)/i },
  { label: "地缘政治", pattern: /(geopolitic|sanction|tariff|war|conflict|election|diplomacy|制裁|关税|冲突|选举|外交)/i },
  { label: "消费电子", pattern: /(apple|iphone|android|device|consumer electronics|pc|smartphone|消费电子|手机|电脑)/i },
  { label: "公共政策", pattern: /(policy|government|国务院|财政|补贴|规划|公共|民生)/i },
  { label: "市场监管", pattern: /(sec|csrc|监管|证券|交易所|market structure|披露)/i }
];
const KEYWORD_CATEGORY_LABELS = {
  tech: "科技",
  finance: "金融",
  business: "商业",
  macro: "宏观",
  international: "国际",
  news: "新闻"
};

const DERIVED_CATEGORY_RULES = [
  {
    id: "macro",
    labels: ["宏观"],
    pattern: /(\bgdp\b|\binflation\b|\bcpi\b|\bppi\b|\bfomc\b|federal reserve|central bank|rate decision|interest rate|\brate\b|treasury|财政|货币政策|宏观|通胀|物价|利率|降息|加息|央行|人民银行|美联储|国债|预算|统计局|经济运行)/i
  },
  {
    id: "international",
    labels: ["国际"],
    pattern: /(\bglobal\b|\bworld\b|international|geopolitic|diplomacy|sanction|tariff|\bwar\b|conflict|election|foreign|联合国|国际|全球|外交|地缘|制裁|关税|战争|冲突|选举|海外)/i
  },
  {
    id: "business",
    labels: ["商业"],
    pattern: /(\bearnings\b|\brevenue\b|\bprofit\b|\bcompany\b|\bstartup\b|\bipo\b|\bmerger\b|\bacquisition\b|\benterprise\b|\bbusiness\b|\bretail\b|\bconsumer\b|财报|营收|利润|公司|企业|商业|并购|上市|创业|消费|零售|国企|民企)/i
  }
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

function detectSourceLanguage(raw, title, summary) {
  const explicit = firstDefined(raw.sourceLanguage, raw.language, raw.lang, "");
  if (explicit) return normalizeText(explicit).slice(0, 8).toLowerCase();
  const text = `${title || ""} ${summary || ""}`;
  if (/[A-Za-z]/.test(text) && !/[\u4e00-\u9fff]/u.test(text)) return "en";
  if (/[\u4e00-\u9fff]/u.test(text)) return "zh";
  return "";
}

function deriveCategory(baseCategory, item) {
  const current = normalizeText(baseCategory).toLowerCase() || "news";
  const text = normalizeText(`${item.title || ""} ${item.summary || ""} ${item.contentExcerpt || ""} ${(item.tags || []).join(" ")}`);
  const match = DERIVED_CATEGORY_RULES.find((rule) => rule.pattern.test(text));
  return match?.id || current;
}

function deriveImpactAreas(item) {
  const text = normalizeText(`${item.title || ""} ${item.summary || ""} ${item.contentExcerpt || ""} ${(item.tags || []).join(" ")}`);
  const areas = DERIVED_CATEGORY_RULES
    .filter((rule) => rule.pattern.test(text))
    .flatMap((rule) => rule.labels);
  return [...new Set(areas)].slice(0, 4);
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
  const sourceLanguage = detectSourceLanguage(raw, title, summary || contentExcerpt);
  const derivedCategory = deriveCategory(category, { title, summary, contentExcerpt, tags });
  const impactAreas = deriveImpactAreas({ title, summary, contentExcerpt, tags });
  const id = [
    slugify(derivedCategory),
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
    category: derivedCategory,
    ...(derivedCategory !== normalizeText(category).toLowerCase() ? { primaryCategory: normalizeText(category).toLowerCase() } : {}),
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
    ...(impactAreas.length ? { impactAreas } : {}),
    ...(sourceLanguage ? { sourceLanguage } : {}),
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
  return getKeywordMatches(item, keywordWeights).reduce((total, entry) => total + Number(entry.score || 0), 0);
}

function getKeywordMatches(item, keywordWeights = {}) {
  const haystack = `${item.title || ""} ${item.summary || ""} ${item.contentExcerpt || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
  const seen = new Set();
  return Object.values(keywordWeights).flat().filter((entry) => {
    const term = String(entry.term || "").toLowerCase();
    if (!term || seen.has(term) || !haystack.includes(term)) return false;
    seen.add(term);
    return true;
  });
}

function pushKeyword(keywords, seen, value) {
  const keyword = normalizeText(value).replace(/^#/, "").trim();
  const normalized = keyword.toLowerCase();
  if (!keyword || keyword.length > 30 || seen.has(normalized)) return;
  if (["official-agency", "official-market", "official-media", "media", "daily", "hourly", "realtime"].includes(normalized)) return;
  seen.add(normalized);
  keywords.push(keyword);
}

function extractArticleKeywords(item, limit = KEYWORD_LIMIT) {
  const keywords = [];
  const seen = new Set();

  (item.article_keywords || []).forEach((keyword) => pushKeyword(keywords, seen, keyword));
  (item.keywordHits || []).forEach((entry) => pushKeyword(keywords, seen, entry.term));
  (item.impactAreas || []).forEach((area) => pushKeyword(keywords, seen, area));
  (item.tags || []).forEach((tag) => pushKeyword(keywords, seen, tag));

  const text = normalizeText([
    item.title_zh,
    item.titleZh,
    item.translatedTitle,
    item.title,
    item.summary_zh,
    item.summaryZh,
    item.aiSummary,
    item.summary,
    item.contentExcerpt
  ].filter(Boolean).join(" "));
  FINE_KEYWORD_RULES.forEach((rule) => {
    if (rule.pattern.test(text)) pushKeyword(keywords, seen, rule.label);
  });
  DERIVED_CATEGORY_RULES.forEach((rule) => {
    if (rule.pattern.test(text)) pushKeyword(keywords, seen, KEYWORD_CATEGORY_LABELS[rule.id] || rule.id);
  });

  [...text.matchAll(/[A-Za-z][A-Za-z0-9+-]{2,}/g)]
    .map((match) => match[0])
    .filter((word) => !ENGLISH_STOPWORDS.has(word.toLowerCase()))
    .slice(0, 16)
    .forEach((word) => pushKeyword(keywords, seen, word));

  [...text.matchAll(/[\u4e00-\u9fff]{2,12}/gu)]
    .map((match) => match[0])
    .slice(0, 16)
    .forEach((word) => pushKeyword(keywords, seen, word));

  return keywords.slice(0, limit);
}

function extractPublishedKeywords(item, limit = KEYWORD_LIMIT) {
  return extractArticleKeywords(item, limit);
}

function canonicalSourceLanguage(item) {
  return normalizeText(item.source_language || item.sourceLanguage || "").toLowerCase();
}

function canonicalTitleZh(item, sourceLanguage) {
  return firstDefined(
    item.title_zh,
    item.titleZh,
    item.translatedTitle,
    sourceLanguage === "zh" ? item.title : ""
  );
}

function canonicalSummaryZh(item, sourceLanguage) {
  return firstDefined(
    item.summary_zh,
    item.summaryZh,
    item.summaryLanguage === "zh" ? item.aiSummary : "",
    sourceLanguage === "zh" ? item.summary : ""
  );
}

function canonicalTranslationStatus(item, sourceLanguage, titleZh, summaryZh) {
  const explicit = firstDefined(item.translation_status, item.translationStatus, "");
  if (explicit) return normalizeText(explicit).toLowerCase();
  if (sourceLanguage !== "en") return "not_required";
  return titleZh || summaryZh ? "translated" : "pending";
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
    const keywordMatches = getKeywordMatches(item, rules.keywordWeights);
    const keywords = keywordMatches.reduce((total, entry) => total + Number(entry.score || 0), 0);
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
      keywordHits: keywordMatches.map((entry) => ({ term: entry.term, score: Number(entry.score || 0) })),
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
  const sourceLanguage = canonicalSourceLanguage(item);
  const titleZh = canonicalTitleZh(item, sourceLanguage);
  const summaryZh = canonicalSummaryZh(item, sourceLanguage);
  const translationStatus = canonicalTranslationStatus(item, sourceLanguage, titleZh, summaryZh);
  const translatedAt = firstDefined(item.translated_at, item.translatedAt, translationStatus === "translated" ? item.summaryGeneratedAt : "");
  const articleKeywords = extractArticleKeywords(item);
  const keywords = articleKeywords;
  const impactAreas = Array.isArray(item.impactAreas) && item.impactAreas.length
    ? item.impactAreas.slice(0, 4).map(normalizeText).filter(Boolean)
    : articleKeywords.slice(0, 4);

  return {
    id: item.id,
    sourceId: item.sourceId,
    title: item.title,
    title_original: truncateText(item.title || "", 180),
    ...(titleZh ? { title_zh: truncateText(titleZh, 120), titleZh: truncateText(titleZh, 120) } : {}),
    ...(item.translatedTitle ? { translatedTitle: truncateText(item.translatedTitle, 120) } : {}),
    url: item.url,
    source: item.source,
    sourceType: item.sourceType,
    category: item.category,
    ...(item.primaryCategory ? { primaryCategory: item.primaryCategory } : {}),
    publishedAt: item.publishedAt,
    fetchedAt: item.fetchedAt,
    sourceLastCheckedAt: item.sourceLastCheckedAt,
    sourceAuthority: item.sourceAuthority,
    timelinessTier: item.timelinessTier,
    summary: publishedSummary,
    summary_original: publishedSummary,
    ...(summaryZh ? { summary_zh: truncateText(summaryZh, PUBLISHED_SUMMARY_LIMIT), summaryZh: truncateText(summaryZh, PUBLISHED_SUMMARY_LIMIT) } : {}),
    ...(contentExcerpt ? { contentExcerpt } : {}),
    ...(item.aiSummary ? { aiSummary: truncateText(item.aiSummary, PUBLISHED_SUMMARY_LIMIT) } : {}),
    ...(item.summaryReason ? { summaryReason: truncateText(item.summaryReason, 180) } : {}),
    ...(item.importance ? { importance: truncateText(item.importance, 180) } : {}),
    ...(impactAreas.length ? { impactAreas } : {}),
    ...(sourceLanguage ? { source_language: sourceLanguage, sourceLanguage } : {}),
    ...(item.summaryLanguage ? { summaryLanguage: item.summaryLanguage } : {}),
    ...(translatedAt ? { translated_at: translatedAt } : {}),
    translation_status: translationStatus,
    ...(imageUrl ? { imageUrl } : {}),
    tags: (item.tags || []).slice(0, 8),
    ...(articleKeywords.length ? { article_keywords: articleKeywords } : {}),
    ...(keywords.length ? { keywords } : {}),
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
  extractPublishedKeywords,
  extractArticleKeywords,
  buildPublishedItem,
  buildLatestData
};
