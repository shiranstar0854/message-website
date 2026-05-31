const path = require("node:path");
const { readJson, readSources, writeJson } = require("./lib/file-utils");
const { extractItems } = require("./lib/rss-parser");

const ROOT_DIR = path.resolve(__dirname, "..");
const RAW_PATH = path.join(ROOT_DIR, "data", "raw", "rss-items.json");
const HEALTH_PATH = path.join(ROOT_DIR, "src", "data", "source-health.json");
const MAX_ATTEMPTS = 2;
const MAX_ITEMS_PER_SOURCE = 15;
const MAX_ITEM_AGE_HOURS = 48;

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function itemDateMs(item, fallback) {
  const date = new Date(item?.publishedAt || item?.published_at || item?.pubDate || item?.isoDate || item?.date || item?.published || item?.updated || fallback);
  const time = date.getTime();
  return Number.isNaN(time) ? new Date(fallback).getTime() : time;
}

function sourceItemLimit(source = {}) {
  const configured = Number(source.maxItems || MAX_ITEMS_PER_SOURCE);
  if (!Number.isFinite(configured) || configured <= 0) return MAX_ITEMS_PER_SOURCE;
  return Math.min(configured, MAX_ITEMS_PER_SOURCE);
}

function sourceMaxAgeHours(source = {}) {
  const configured = Number(source.maxAgeHours || MAX_ITEM_AGE_HOURS);
  if (!Number.isFinite(configured) || configured <= 0) return MAX_ITEM_AGE_HOURS;
  return Math.min(configured, MAX_ITEM_AGE_HOURS);
}

function limitNewestItems(items, source = {}, fallbackDate = new Date().toISOString()) {
  const nowTime = new Date(fallbackDate).getTime();
  const maxAgeMs = sourceMaxAgeHours(source) * 60 * 60 * 1000;
  return [...(items || [])]
    .filter((item) => {
      const publishedTime = itemDateMs(item, fallbackDate);
      return Number.isNaN(nowTime) || publishedTime >= nowTime - maxAgeMs;
    })
    .sort((left, right) => itemDateMs(right, fallbackDate) - itemDateMs(left, fallbackDate))
    .slice(0, sourceItemLimit(source));
}

async function fetchRssSource(source, fetchedAt) {
  let lastResult = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(source.url, {
        headers: {
          "user-agent": "message-choose/0.1 (+https://github.com)"
        },
        signal: AbortSignal.timeout(20000)
      });
      const body = await response.text();
      const items = limitNewestItems(extractItems(body), source, fetchedAt);
      lastResult = {
        sourceId: source.id,
        sourceName: source.name,
        sourceType: "rss",
        category: source.category,
        credibility: source.credibility,
        url: source.url,
        status: response.status,
        ok: response.ok,
        itemCount: items.length,
        fetchedAt,
        attempts: attempt,
        items
      };
    } catch (error) {
      lastResult = {
        sourceId: source.id,
        sourceName: source.name,
        sourceType: "rss",
        category: source.category,
        credibility: source.credibility,
        url: source.url,
        ok: false,
        fetchedAt,
        attempts: attempt,
        error: error.message
      };
    }

    if (isUsableResult(lastResult) || attempt === MAX_ATTEMPTS) {
      return lastResult;
    }
    await wait(1000);
  }

  return lastResult;
}

async function fetchRssSources() {
  const fetchedAt = new Date().toISOString();
  const sources = readSources(ROOT_DIR).filter((source) => source.type === "rss" && source.enabled !== false);
  const results = [];

  for (const source of sources) {
    results.push(await fetchRssSource(source, fetchedAt));
  }

  return results;
}

function isUsableResult(result) {
  return result.ok === true && Number(result.itemCount || 0) > 0;
}

function getRecordItems(record) {
  const fallbackDate = record?.fetchedAt || new Date().toISOString();
  if (Array.isArray(record?.items)) return limitNewestItems(record.items, record, fallbackDate);
  if (record?.body) return limitNewestItems(extractItems(record.body), record, fallbackDate);
  return [];
}

function compactResult(result) {
  const items = getRecordItems(result);
  const { body, ...rest } = result;
  return {
    ...rest,
    itemCount: Number(result.itemCount || items.length || 0),
    items
  };
}

function buildSourceHealth(results, previousHealth = { sources: [] }, generatedAt = new Date().toISOString()) {
  const previousById = new Map((previousHealth.sources || []).map((source) => [source.id, source]));
  return {
    generatedAt,
    sources: results.map((result) => {
      const previous = previousById.get(result.sourceId) || {};
      const healthy = isUsableResult(result);
      const status = healthy ? "healthy" : result.ok ? "empty" : "failed";
      const failed = status === "failed";
      return {
        id: result.sourceId,
        name: result.sourceName,
        category: result.category,
        status,
        itemCount: Number(result.itemCount || 0),
        responseStatus: result.status || null,
        attempts: Number(result.attempts || 1),
        error: result.error || null,
        lastCheckedAt: result.fetchedAt,
        lastSuccessAt: healthy ? result.fetchedAt : previous.lastSuccessAt || null,
        failureCount: failed ? Number(previous.failureCount || 0) + 1 : 0
      };
    })
  };
}

function buildEffectiveResults(results, previousResults = []) {
  const previousById = new Map(previousResults.map((result) => [result.sourceId, result]));

  return results.map((result) => {
    if (isUsableResult(result)) {
      return { ...compactResult(result), stale: false };
    }
    if (result.ok === true) {
      return { ...compactResult(result), items: [], itemCount: 0, stale: false };
    }

    const previous = previousById.get(result.sourceId);
    const previousItems = getRecordItems(previous);
    const previousItemCount = previousItems.length;
    if (!previous || previousItemCount === 0) {
      return { ...compactResult(result), stale: false };
    }

    return {
      ...compactResult(previous),
      sourceName: result.sourceName,
      category: result.category,
      credibility: result.credibility,
      url: result.url,
      itemCount: previousItemCount,
      stale: true,
      latestAttempt: {
        fetchedAt: result.fetchedAt,
        ok: result.ok,
        status: result.status || null,
        itemCount: Number(result.itemCount || 0),
        error: result.error || null
      }
    };
  });
}

function writeFetchOutputs(results) {
  const previousResults = readJson(RAW_PATH, []);
  const previousHealth = readJson(HEALTH_PATH, { sources: [] });
  const health = buildSourceHealth(results, previousHealth);
  const effectiveResults = buildEffectiveResults(results, previousResults);
  writeJson(RAW_PATH, effectiveResults);
  writeJson(HEALTH_PATH, health);
  return { effectiveResults, health };
}

if (require.main === module) {
  fetchRssSources()
    .then((results) => {
      const { health } = writeFetchOutputs(results);
      const failedCount = health.sources.filter((source) => source.status !== "healthy").length;
      console.log(`Fetched ${results.length} RSS source records; ${failedCount} unavailable or empty.`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  fetchRssSources,
  fetchRssSource,
  getRecordItems,
  limitNewestItems,
  isUsableResult,
  buildSourceHealth,
  buildEffectiveResults,
  writeFetchOutputs
};
