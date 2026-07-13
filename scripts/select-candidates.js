const path = require("node:path");
const { readJson, readSources, writeJson } = require("./lib/file-utils");
const { selectCandidates } = require("./lib/content-selection");

const ROOT_DIR = path.resolve(__dirname, "..");

function runCandidateSelection() {
  const sourceById = new Map(readSources(ROOT_DIR).map((source) => [source.id, source]));
  const items = readJson(path.join(ROOT_DIR, "data", "processed", "deduped-items.json"), []).map((item) => {
    const source = sourceById.get(item.sourceId) || {};
    return { ...item, sourcePolicyTier: source.sourcePolicyTier, bodyFetchQuota: source.bodyFetchQuota };
  });
  const recent = readJson(path.join(ROOT_DIR, "src", "data", "latest-items.json"), { items: [] }).items || [];
  const rules = readJson(path.join(ROOT_DIR, "config", "content-selection-rules.json"), {});
  const result = selectCandidates(items, { rules, recentItems: recent });
  writeJson(path.join(ROOT_DIR, "data", "processed", "candidate-items.json"), {
    generatedAt: new Date().toISOString(),
    limits: rules,
    selectedCount: result.selected.length,
    rejectedCount: result.rejected.length,
    items: result.selected,
    rejected: result.rejected
  });
  return result;
}

if (require.main === module) {
  const result = runCandidateSelection();
  console.log(`Selected ${result.selected.length} of ${result.prepared.length} metadata candidates for body fetching.`);
}

module.exports = { runCandidateSelection };
