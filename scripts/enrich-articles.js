const path = require("node:path");
const { parse } = require("node-html-parser");
const { readJson, readSources, writeJson } = require("./lib/file-utils");
const { normalizeImageUrl, normalizeText, sortItems, truncateText } = require("./lib/pipeline");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_LIMIT_PER_CHANNEL = 20;
const DEFAULT_CONCURRENCY = 5;

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function findMetaContent(root, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const meta of root.querySelectorAll("meta")) {
    const key = String(meta.getAttribute("property") || meta.getAttribute("name") || "").toLowerCase();
    const content = meta.getAttribute("content");
    if (wanted.has(key) && content) return decodeEntities(content);
  }
  return "";
}

function collectArticleBodies(value, bodies = []) {
  if (!value) return bodies;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectArticleBodies(entry, bodies));
    return bodies;
  }
  if (typeof value !== "object") return bodies;
  if (typeof value.articleBody === "string") bodies.push(value.articleBody);
  Object.values(value).forEach((entry) => collectArticleBodies(entry, bodies));
  return bodies;
}

function structuredArticleText(root) {
  return root.querySelectorAll('script[type="application/ld+json"]')
    .flatMap((script) => {
      try {
        return collectArticleBodies(JSON.parse(script.text));
      } catch {
        return [];
      }
    })
    .map((text) => normalizeText(decodeEntities(text)))
    .filter((text) => text.length >= 40)
    .join(" ");
}

function paragraphsFromArticle(root) {
  const articles = root.querySelectorAll("article");
  return articles.flatMap((article) => article.querySelectorAll("p")
    .map((paragraph) => normalizeText(decodeEntities(paragraph.text)))
    .filter((text) => text.length >= 40));
}

function resolveHttpsImageUrl(value, baseUrl = "") {
  if (!value) return "";
  try {
    return normalizeImageUrl(new URL(String(value).trim(), baseUrl || undefined).toString());
  } catch {
    return normalizeImageUrl(value);
  }
}

function extractArticleData(html, item = {}) {
  const root = parse(String(html || ""));
  root.querySelectorAll("script:not([type=\"application/ld+json\"]), style, noscript").forEach((node) => node.remove());

  const structuredText = structuredArticleText(root);
  const articleText = structuredText || paragraphsFromArticle(root).join(" ");
  const metaDescription = normalizeText(decodeEntities(findMetaContent(root, [
    "og:description",
    "twitter:description",
    "description"
  ])));
  const metaImage = resolveHttpsImageUrl(findMetaContent(root, [
    "og:image",
    "twitter:image",
    "twitter:image:src"
  ]), item.url);

  const pageExcerpt = truncateText(articleText || metaDescription, 500);
  const feedExcerpt = truncateText(item.contentExcerpt || item.summary || "", 500);
  const imageUrl = metaImage || normalizeImageUrl(item.imageUrl || "");

  return {
    contentExcerpt: pageExcerpt || feedExcerpt,
    imageUrl,
    excerptSource: pageExcerpt ? (articleText ? "article" : "meta") : (feedExcerpt ? "feed" : "none"),
    imageSource: metaImage ? "meta" : (imageUrl ? "feed" : "none")
  };
}

function sourceAllowsEnrichment(source) {
  return source?.articleEnrichment?.enabled !== false;
}

function selectEnrichmentCandidates(items, sources, limitPerChannel = DEFAULT_LIMIT_PER_CHANNEL) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const sourceByName = new Map(sources.map((source) => [source.name, source]));
  const counts = new Map();

  return sortItems(items).filter((item) => {
    if (!item.url) return false;
    const category = item.category || "uncategorized";
    const categoryCount = counts.get(category) || 0;
    if (categoryCount >= limitPerChannel) return false;
    counts.set(category, categoryCount + 1);

    const source = sourceById.get(item.sourceId) || sourceByName.get(item.source);
    return sourceAllowsEnrichment(source);
  });
}

function createStats(sources, generatedAt = new Date().toISOString()) {
  return {
    generatedAt,
    totals: {
      attempted: 0,
      excerptCount: 0,
      imageCount: 0,
      failed: 0,
      skipped: 0
    },
    sources: sources.reduce((stats, source) => {
      stats[source.id] = {
        sourceId: source.id,
        sourceName: source.name,
        attempted: 0,
        excerptCount: 0,
        imageCount: 0,
        failed: 0,
        skipped: 0,
        disabled: !sourceAllowsEnrichment(source)
      };
      return stats;
    }, {})
  };
}

async function fetchArticleHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "message-choose/0.1 (+https://github.com)",
      accept: "text/html,application/xhtml+xml"
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function enrichOne(item, fetchArticle = fetchArticleHtml) {
  const html = await fetchArticle(item.url);
  const extracted = extractArticleData(html, item);
  return {
    ...item,
    ...(extracted.contentExcerpt ? { contentExcerpt: extracted.contentExcerpt } : {}),
    ...(extracted.imageUrl ? { imageUrl: extracted.imageUrl } : {})
  };
}

async function runConcurrent(items, worker, concurrency = DEFAULT_CONCURRENCY) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function enrichItems(items, sources, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const stats = createStats(sources, generatedAt);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const sourceByName = new Map(sources.map((source) => [source.name, source]));
  const candidates = selectEnrichmentCandidates(items, sources, options.limitPerChannel || DEFAULT_LIMIT_PER_CHANNEL);
  const candidateIds = new Set(candidates.map((item) => item.id));
  const enrichedById = new Map();

  items.forEach((item) => {
    if (candidateIds.has(item.id)) return;
    const source = sourceById.get(item.sourceId) || sourceByName.get(item.source);
    if (source && !sourceAllowsEnrichment(source)) {
      const sourceStats = stats.sources[source.id];
      sourceStats.skipped += 1;
      stats.totals.skipped += 1;
    }
  });

  await runConcurrent(candidates, async (item) => {
    const source = sourceById.get(item.sourceId) || sourceByName.get(item.source);
    const sourceStats = stats.sources[source?.id] || null;
    if (sourceStats) sourceStats.attempted += 1;
    stats.totals.attempted += 1;

    try {
      const enriched = await enrichOne(item, options.fetchArticle);
      enrichedById.set(item.id, enriched);
      if (enriched.contentExcerpt) {
        if (sourceStats) sourceStats.excerptCount += 1;
        stats.totals.excerptCount += 1;
      }
      if (enriched.imageUrl) {
        if (sourceStats) sourceStats.imageCount += 1;
        stats.totals.imageCount += 1;
      }
    } catch (error) {
      enrichedById.set(item.id, item);
      if (sourceStats) {
        sourceStats.failed += 1;
        sourceStats.lastError = error.message;
      }
      stats.totals.failed += 1;
    }
  }, options.concurrency || DEFAULT_CONCURRENCY);

  return {
    items: items.map((item) => enrichedById.get(item.id) || item),
    stats
  };
}

async function enrichScoredItems() {
  const sources = readSources(ROOT_DIR).filter((source) => source.type === "rss" && source.enabled !== false);
  const items = readJson(path.join(ROOT_DIR, "data", "processed", "scored-items.json"), []);
  const result = await enrichItems(items, sources);
  writeJson(path.join(ROOT_DIR, "data", "processed", "scored-items.json"), result.items);
  writeJson(path.join(ROOT_DIR, "data", "processed", "article-enrichment.json"), result.stats);
  return result;
}

if (require.main === module) {
  enrichScoredItems()
    .then((result) => {
      console.log(`Enriched articles: attempted ${result.stats.totals.attempted}, failed ${result.stats.totals.failed}.`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  extractArticleData,
  selectEnrichmentCandidates,
  enrichItems,
  enrichScoredItems
};
