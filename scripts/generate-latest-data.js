const path = require("node:path");
const { buildLatestData } = require("./lib/pipeline");
const { readJson, writeJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");

function generateLatestData(nowIso = new Date().toISOString()) {
  const items = readJson(path.join(ROOT_DIR, "data", "processed", "scored-items.json"), []);
  const siteConfig = readJson(path.join(ROOT_DIR, "public", "site-config.json"), {});
  return buildLatestData(items, siteConfig, nowIso);
}

if (require.main === module) {
  const latest = generateLatestData();
  writeJson(path.join(ROOT_DIR, "src", "data", "latest-items.json"), latest);
  console.log(`Generated latest data with ${latest.totalItems} items.`);
}

module.exports = {
  generateLatestData
};
