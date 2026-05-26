const path = require("node:path");
const { readSources, writeJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");

function expandEnv(value) {
  return String(value || "").replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] || "");
}

async function fetchOfficialApiSources() {
  const fetchedAt = new Date().toISOString();
  const sources = readSources(ROOT_DIR).filter((source) => source.type === "api" && source.enabled === true);
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
      console.log(`Fetched ${results.length} API source records.`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  fetchOfficialApiSources
};
