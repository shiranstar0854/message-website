const path = require("node:path");
const { readSources, recordFetchAttempts, writeJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");

function expandEnv(value) {
  return String(value || "").replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] || "");
}

function countApiItems(body) {
  if (Array.isArray(body)) return body.length;
  if (!body || typeof body !== "object") return 0;
  const collection = [body.items, body.results, body.data, body.records].find(Array.isArray);
  return collection?.length || 0;
}

async function fetchOfficialApiSources() {
  const fetchedAt = new Date().toISOString();
  const sources = readSources(ROOT_DIR).filter((source) => source.type === "api" && source.enabled === true && source.runtimeFetchEnabled !== false);
  const results = [];

  for (const source of sources) {
    try {
      const response = await fetch(expandEnv(source.url), {
        headers: source.headers || {}
      });
      const body = await response.json();
      results.push({
        sourceId: source.id,
        sourceName: source.name,
        sourceType: "api",
        category: source.category,
        credibility: source.credibility,
        url: source.url,
        status: response.status,
        ok: response.ok,
        fetchedAt,
        itemCount: countApiItems(body),
        body
      });
    } catch (error) {
      results.push({
        sourceId: source.id,
        sourceName: source.name,
        sourceType: "api",
        category: source.category,
        credibility: source.credibility,
        url: source.url,
        ok: false,
        fetchedAt,
        error: error.message
      });
    }
  }

  return results;
}

if (require.main === module) {
  fetchOfficialApiSources()
    .then((results) => {
      writeJson(path.join(ROOT_DIR, "data", "raw", "api-items.json"), results);
      recordFetchAttempts(ROOT_DIR, "api", results, results[0]?.fetchedAt || new Date().toISOString());
      console.log(`Fetched ${results.length} API source records.`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  fetchOfficialApiSources,
  countApiItems
};
