const path = require("node:path");
const { filterItems } = require("./lib/pipeline");
const { readJson, writeJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");

function runFilter() {
  const items = readJson(path.join(ROOT_DIR, "data", "normalized", "normalized-items.json"), []);
  const rules = readJson(path.join(ROOT_DIR, "config", "filter-rules.json"), {});
  return filterItems(items, rules);
}

if (require.main === module) {
  const filtered = runFilter();
  writeJson(path.join(ROOT_DIR, "data", "processed", "filtered-items.json"), filtered);
  console.log(`Filtered down to ${filtered.length} items.`);
}

module.exports = {
  runFilter
};
