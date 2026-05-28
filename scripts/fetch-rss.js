const path = require("node:path");
const { readJson, readSources, writeJson } = require("./lib/file-utils");
const { extractItems } = require("./lib/rss-parser");

const ROOT_DIR = path.resolve(__dirname, "..");
const RAW_PATH = path.join(ROOT_DIR, "data", "raw", "rss-items.json");
const HEALTH_PATH = path.join(ROOT_DIR, "src", "data", "source-health.json");
const MAX_ATTEMPTS = 2;

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
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
      const items = extractItems(body);
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
  if (Array.isArray(record?.items)) return record.items;
  if (record?.body) return extractItems(record.body);
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
        failureCount: healthy ? 0 : Number(previous.failureCount || 0) + 1
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
  isUsableResult,
  buildSourceHealth,
  buildEffectiveResults,
  writeFetchOutputs
};
