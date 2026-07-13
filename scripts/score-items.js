const path = require("node:path");
const { scoreItems } = require("./lib/pipeline");
const { readJson, writeJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");

function runScoring(nowIso = new Date().toISOString()) {
  const items = readJson(path.join(ROOT_DIR, "data", "processed", "classified-items.json"), []);
  const rules = readJson(path.join(ROOT_DIR, "config", "scoring-rules.json"), {});
  const clusterSources = items.reduce((map, item) => {
    const key = item.eventClusterKey || item.id;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(item.sourceId || item.source);
    return map;
  }, new Map());
  return scoreItems(items, rules, nowIso).map((item) => {
    const densityBoost = (Number(item.contentDensity || 0) - 55) * 0.12;
    const candidateBoost = (Number(item.candidateValue || 0) - 60) * 0.1;
    const classificationBoost = Number(item.classification?.confidence || 0.5) * 5;
    const independentSourceCount = clusterSources.get(item.eventClusterKey || item.id)?.size || 1;
    const independentSourceBoost = Math.min(6, Math.max(0, independentSourceCount - 1) * 2);
    const evidencePenalty = item.contentReviewStatus === "metadata-only" ? 8 : 0;
    const baseScore = Number(item.score || 0);
    const finalScore = Math.max(0, Math.min(100, Number((baseScore + densityBoost + candidateBoost + classificationBoost + independentSourceBoost - evidencePenalty).toFixed(2))));
    return {
      ...item,
      independentSourceCount,
      score: finalScore,
      finalScoreBreakdown: {
        baseScore,
        informationDensity: Number(densityBoost.toFixed(2)),
        informationGain: Number(candidateBoost.toFixed(2)),
        classificationConfidence: Number(classificationBoost.toFixed(2)),
        independentSources: independentSourceBoost,
        evidencePenalty: -evidencePenalty,
        finalScore
      }
    };
  });
}

if (require.main === module) {
  const scored = runScoring();
  writeJson(path.join(ROOT_DIR, "data", "processed", "scored-items.json"), scored);
  console.log(`Scored ${scored.length} items.`);
}

module.exports = {
  runScoring
};
