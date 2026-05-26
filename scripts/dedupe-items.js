const path = require("node:path");
const { dedupeItems } = require("./lib/pipeline");
const { readJson, writeJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");

function runDedupe() {
  const items = readJson(path.join(ROOT_DIR, "data", "processed", "filtered-items.json"), []);
  const rules = readJson(path.join(ROOT_DIR, "config", "dedupe-rules.json"), {});
  return dedupeItems(items, rules);
}

if (require.main === module) {
  const deduped = runDedupe();
  writeJson(path.join(ROOT_DIR, "data", "processed", "deduped-items.json"), deduped);
  console.log(`Deduped down to ${deduped.length} items.`);
}

module.exports = {
  runDedupe
};
