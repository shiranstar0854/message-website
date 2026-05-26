const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) return fallback;
  return JSON.parse(content);
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readSources(rootDir) {
  return ["tech", "finance", "news"].flatMap((category) => {
    const filePath = path.join(rootDir, "config", `sources.${category}.json`);
    const config = readJson(filePath, { category, sources: [] });
    return (config.sources || []).map((source) => ({ ...source, category }));
  });
}

module.exports = {
  readJson,
  writeJson,
  readSources
};
