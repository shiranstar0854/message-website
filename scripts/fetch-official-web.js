const path = require("node:path");
const { parse } = require("node-html-parser");
const { readJson, readSources, writeJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");
const RAW_PATH = path.join(ROOT_DIR, "data", "raw", "webpage-items.json");
const HEALTH_PATH = path.join(ROOT_DIR, "src", "data", "source-health.json");
const MAX_ITEMS = 30;

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(String(value || ""), baseUrl).toString();
  } catch {
    return "";
  }
}

function dateFromValue(value, fallback) {
  const text = String(value || "");
  const compact = text.match(/(20\d{2})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}T00:00:00.000Z`;
  const separated = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (separated) {
    return `${separated[1]}-${separated[2].padStart(2, "0")}-${separated[3].padStart(2, "0")}T00:00:00.000Z`;
  }
  return fallback;
}

function shouldKeepLink(source, item) {
  if (!item.title || item.title.length < 6 || !item.link) return false;
  if (/^(首页|更多|加载更多|联系我们|网站地图|English|EN|简|繁|无障碍)$/.test(item.title)) return false;
  if (source.includeUrlPattern && !(new RegExp(source.includeUrlPattern).test(item.link))) return false;
  if (source.excludeTitlePattern && new RegExp(source.excludeTitlePattern).test(item.title)) return false;
  return true;
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.title}|${item.link}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mapJsonItems(source, body, fetchedAt) {
  const items = Array.isArray(body)
    ? body
    : Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body?.data)
        ? body.data
        : [];
  const mapping = source.mapping || {};
  return items.map((item) => {
    const title = normalizeText(item[mapping.title || "title"]);
    const link = absoluteUrl(item[mapping.url || "url"], source.url);
    const publishedAt = dateFromValue(item[mapping.publishedAt || "publishedAt"] || link, fetchedAt);
    return {
      title,
      link,
      publishedAt,
      summary: normalizeText(item[mapping.summary || "summary"] || source.purpose || ""),
      sourceAuthority: source.sourceAuthority,
      timelinessTier: source.timelinessTier,
      tags: [source.sourceAuthority, source.timelinessTier].filter(Boolean)
    };
  }).filter((item) => shouldKeepLink(source, item)).slice(0, Number(source.maxItems || MAX_ITEMS));
}

function extractScriptItems(source, html, fetchedAt) {
  const items = [];
  const scriptPattern = /var\s+curHref\s*=\s*['"]([^'"]+)['"][\s\S]{0,420}?var\s+curTitle\s*=\s*['"]([^'"]+)['"]/g;
  let match = scriptPattern.exec(html);
  while (match) {
    const link = absoluteUrl(match[1], source.url);
    items.push({
      title: normalizeText(match[2]),
      link,
      publishedAt: dateFromValue(link, fetchedAt),
      summary: source.purpose || "",
      sourceAuthority: source.sourceAuthority,
      timelinessTier: source.timelinessTier,
      tags: [source.sourceAuthority, source.timelinessTier].filter(Boolean)
    });
    match = scriptPattern.exec(html);
  }
  return items.filter((item) => shouldKeepLink(source, item));
}

function extractHtmlItems(source, html, fetchedAt) {
  const root = parse(html);
  const anchorItems = root.querySelectorAll("a").map((anchor) => {
    const title = normalizeText(anchor.text);
    const link = absoluteUrl(anchor.getAttribute("href"), source.url);
    return {
      title,
      link,
      publishedAt: dateFromValue(`${link} ${anchor.parentNode?.text || ""}`, fetchedAt),
      summary: source.purpose || "",
      sourceAuthority: source.sourceAuthority,
      timelinessTier: source.timelinessTier,
      tags: [source.sourceAuthority, source.timelinessTier].filter(Boolean)
    };
  }).filter((item) => shouldKeepLink(source, item));

  return dedupeItems([...anchorItems, ...extractScriptItems(source, html, fetchedAt)]).slice(0, Number(source.maxItems || MAX_ITEMS));
}

async function fetchWebpageSource(source, fetchedAt) {
  try {
    const response = await fetch(source.url, {
      headers: {
        "user-agent": "message-choose/0.1 (+https://github.com)",
        ...(source.headers || {})
      },
      signal: AbortSignal.timeout(Number(source.timeoutMs || 30000))
    });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("json") || source.adapter === "json-list"
      ? await response.json()
      : await response.text();
    const items = typeof body === "string"
      ? extractHtmlItems(source, body, fetchedAt)
      : mapJsonItems(source, body, fetchedAt);

    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceType: "webpage",
      sourceAuthority: source.sourceAuthority,
      timelinessTier: source.timelinessTier,
      category: source.category,
      credibility: source.credibility,
      url: source.url,
      status: response.status,
      ok: response.ok,
      itemCount: items.length,
      fetchedAt,
      attempts: 1,
      items
    };
  } catch (error) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceType: "webpage",
      sourceAuthority: source.sourceAuthority,
      timelinessTier: source.timelinessTier,
      category: source.category,
      credibility: source.credibility,
      url: source.url,
      ok: false,
      fetchedAt,
      attempts: 1,
      error: error.message
    };
  }
}

function isUsableResult(result) {
  return result.ok === true && Number(result.itemCount || 0) > 0;
}

function buildEffectiveResults(results, previousResults = []) {
  const previousById = new Map(previousResults.map((result) => [result.sourceId, result]));
  return results.map((result) => {
    if (isUsableResult(result)) return { ...result, stale: false };
    const previous = previousById.get(result.sourceId);
    if (!previous?.items?.length) return { ...result, items: [], itemCount: 0, stale: false };
    return {
      ...previous,
      sourceName: result.sourceName,
      sourceAuthority: result.sourceAuthority,
      timelinessTier: result.timelinessTier,
      category: result.category,
      credibility: result.credibility,
      url: result.url,
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
        sourceType: result.sourceType,
        sourceAuthority: result.sourceAuthority || null,
        timelinessTier: result.timelinessTier || null,
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

function mergeSourceHealth(previousHealth, nextHealth) {
  const nextIds = new Set(nextHealth.sources.map((source) => source.id));
  return {
    generatedAt: nextHealth.generatedAt,
    sources: [
      ...(previousHealth.sources || []).filter((source) => !nextIds.has(source.id)),
      ...nextHealth.sources
    ]
  };
}

async function fetchOfficialWebSources() {
  const fetchedAt = new Date().toISOString();
  const sources = readSources(ROOT_DIR).filter((source) => source.type === "webpage" && source.enabled !== false);
  const results = [];
  for (const source of sources) {
    results.push(await fetchWebpageSource(source, fetchedAt));
  }
  return results;
}

function writeFetchOutputs(results) {
  const previousResults = readJson(RAW_PATH, []);
  const previousHealth = readJson(HEALTH_PATH, { sources: [] });
  const effectiveResults = buildEffectiveResults(results, previousResults);
  const webHealth = buildSourceHealth(results, previousHealth);
  const mergedHealth = mergeSourceHealth(previousHealth, webHealth);
  writeJson(RAW_PATH, effectiveResults);
  writeJson(HEALTH_PATH, mergedHealth);
  return { effectiveResults, health: mergedHealth };
}

if (require.main === module) {
  fetchOfficialWebSources()
    .then((results) => {
      const { health } = writeFetchOutputs(results);
      const webIds = new Set(results.map((result) => result.sourceId));
      const failedCount = health.sources.filter((source) => webIds.has(source.id) && source.status !== "healthy").length;
      console.log(`Fetched ${results.length} official webpage source records; ${failedCount} unavailable or empty.`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  fetchOfficialWebSources,
  fetchWebpageSource,
  extractHtmlItems,
  mapJsonItems,
  buildSourceHealth,
  buildEffectiveResults,
  mergeSourceHealth,
  writeFetchOutputs
};
