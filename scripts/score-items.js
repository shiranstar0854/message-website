const path = require("node:path");
const { scoreItems } = require("./lib/pipeline");
const { readJson, writeJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");

function runScoring(nowIso = new Date().toISOString()) {
  const items = readJson(path.join(ROOT_DIR, "data", "processed", "deduped-items.json"), []);
  const rules = readJson(path.join(ROOT_DIR, "config", "scoring-rules.json"), {});
  return scoreItems(items, rules, nowIso);
}

if (require.main === module) {
  const scored = runScoring();
  writeJson(path.join(ROOT_DIR, "data", "processed", "scored-items.json"), scored);
  console.log(`Scored ${scored.length} items.`);
}

module.exports = {
  runScoring
};
