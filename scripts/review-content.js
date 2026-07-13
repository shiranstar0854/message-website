const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");
const { assessContent } = require("./lib/content-selection");

const ROOT_DIR = path.resolve(__dirname, "..");

function reviewContent(items, rules = {}) {
  const accepted = [];
  const rejected = [];
  for (const original of items) {
    const assessed = { ...original, ...assessContent(original) };
    const bodyDisabled = assessed.bodyFetchStatus === "disabled";
    const official = ["official-agency", "official-market"].includes(assessed.sourceAuthority);
    const threshold = official ? Number(rules.officialContentDensityThreshold || 45) : Number(rules.contentDensityThreshold || 55);
    let reviewStatus = "accepted";
    let reviewReason = "content-density-passed";
    if (bodyDisabled) {
      reviewStatus = assessed.candidateValue >= Number(rules.metadataOnlyThreshold || 75) ? "metadata-only" : "rejected";
      reviewReason = "body-fetch-disabled";
    } else if (!assessed.bodyFetchStatus) {
      reviewStatus = "rejected";
      reviewReason = "body-fetch-status-missing";
    } else if (assessed.bodyFetchStatus === "failed") {
      reviewStatus = assessed.candidateValue >= Number(rules.metadataOnlyThreshold || 75) ? "metadata-only" : "rejected";
      reviewReason = "body-fetch-failed";
    } else if (assessed.contentDensity < threshold) {
      reviewStatus = official && assessed.contentDensity >= Number(rules.officialContentDensityThreshold || 45) ? "accepted-with-limitations" : "rejected";
      reviewReason = "low-content-density";
    }
    const item = { ...assessed, contentReviewStatus: reviewStatus, contentReviewReason: reviewReason };
    if (reviewStatus === "rejected") rejected.push(item); else accepted.push(item);
  }
  return { accepted, rejected };
}

function runContentReview() {
  const items = readJson(path.join(ROOT_DIR, "data", "processed", "enriched-candidates.json"), []);
  const rules = readJson(path.join(ROOT_DIR, "config", "content-selection-rules.json"), {});
  const result = reviewContent(items, rules);
  writeJson(path.join(ROOT_DIR, "data", "processed", "content-reviewed-items.json"), {
    generatedAt: new Date().toISOString(),
    acceptedCount: result.accepted.length,
    rejectedCount: result.rejected.length,
    items: result.accepted,
    rejected: result.rejected
  });
  return result;
}

if (require.main === module) {
  const result = runContentReview();
  console.log(`Content review accepted ${result.accepted.length}; rejected ${result.rejected.length}.`);
}

module.exports = { reviewContent, runContentReview };
