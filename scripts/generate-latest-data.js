const path = require("node:path");
const { buildLatestData } = require("./lib/pipeline");
const { readJson, writeJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");

function buildLatestDataSafely(items, siteConfig, previous, nowIso) {
  if (!items.length && previous?.items?.length) {
    return {
      ...previous,
      preservation: {
        reason: "empty-current-pipeline-output",
        checkedAt: nowIso,
        retainedGeneratedAt: previous.generatedAt || ""
      }
    };
  }
  return buildLatestData(items, siteConfig, nowIso);
}

function generateLatestData(nowIso = new Date().toISOString()) {
  const translated = readJson(path.join(ROOT_DIR, "data", "processed", "translated-items.json"), { items: [] });
  const siteConfig = readJson(path.join(ROOT_DIR, "public", "site-config.json"), {});
  const previous = readJson(path.join(ROOT_DIR, "src", "data", "latest-items.json"), null);
  const scoreFloor = Number(siteConfig.scoreFloor || 0);
  const items = (translated.items || []).filter((item) => Number(item.score || 0) >= scoreFloor);
  return buildLatestDataSafely(items, siteConfig, previous, translated.generatedAt || nowIso);
}

function publishLatestData(nowIso = new Date().toISOString()) {
  const latest = generateLatestData(nowIso);
  const preserved = Boolean(latest.preservation);
  writeJson(path.join(ROOT_DIR, "data", "processed", "pipeline-state.json"), {
    runId: `pipeline-${nowIso.replace(/[^0-9]/g, "").slice(0, 14)}`,
    generatedAt: nowIso,
    publicDataPreserved: preserved,
    reason: latest.preservation?.reason || "",
    scoredItemCount: readJson(path.join(ROOT_DIR, "data", "processed", "scored-items.json"), []).length,
    translatedItemCount: readJson(path.join(ROOT_DIR, "data", "processed", "translated-items.json"), { items: [] }).items.length
  });
  if (!preserved) writeJson(path.join(ROOT_DIR, "src", "data", "latest-items.json"), latest);
  return latest;
}

if (require.main === module) {
  const latest = publishLatestData();
  console.log(`${latest.preservation ? "Preserved" : "Generated"} latest data with ${latest.totalItems} items.`);
}

module.exports = {
  buildLatestDataSafely,
  generateLatestData,
  publishLatestData
};
