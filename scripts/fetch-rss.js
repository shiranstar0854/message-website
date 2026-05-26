const path = require("node:path");
const { readSources, writeJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");

async function fetchRssSources() {
  const fetchedAt = new Date().toISOString();
  const sources = readSources(ROOT_DIR).filter((source) => source.type === "rss" && source.enabled !== false);
  const results = [];

  for (const source of sources) {
    try {
      const response = await fetch(source.url, {
        headers: {
          "user-agent": "message-choose/0.1 (+https://github.com)"
        }
      });
      const body = await response.text();
      results.push({
        sourceId: source.id,
        sourceName: source.name,
        sourceType: "rss",
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
        sourceType: "rss",
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
  fetchRssSources()
    .then((results) => {
      writeJson(path.join(ROOT_DIR, "data", "raw", "rss-items.json"), results);
      console.log(`Fetched ${results.length} RSS source records.`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  fetchRssSources
};
