const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyEventType, assignEventClusters, selectCandidates } = require("../scripts/lib/content-selection");
const { classifyMetadataCategory, classifyLocally, CANONICAL_CATEGORIES } = require("../scripts/lib/classification");
const { classifyItems } = require("../scripts/classify-items");
const { reviewContent } = require("../scripts/review-content");
const { metricsForWindows, nextStatus } = require("../scripts/lib/source-policy");

const rules = {
  candidateThreshold: 60,
  globalBodyFetchQuota: 36,
  categoryQuota: 8,
  eventTypeQuota: 5,
  eventClusterQuota: 3,
  sourceTierQuotas: { core: 5, standard: 3, experimental: 1 },
  blockedPatterns: ["招聘", "促销", "tutorial"]
};

function item(id, overrides = {}) {
  return {
    id,
    title: `Official policy release ${id} includes 2026 implementation data`,
    summary: "The authority announced a new policy with a dated implementation action and measurable requirements.",
    url: `https://example.test/${id}`,
    source: `Source ${id}`,
    sourceId: `source-${id}`,
    sourceTier: "S",
    sourceAuthority: "official-agency",
    category: "policy",
    publishedAt: "2026-07-12T00:00:00.000Z",
    ...overrides
  };
}

test("promotion and tutorial metadata are rejected before body selection", () => {
  assert.equal(classifyEventType(item("promo", { title: "限时促销活动预告和报名优惠" })), "promotion");
  const result = selectCandidates([item("promo", { title: "招聘促销活动预告和报名优惠" })], { rules });
  assert.equal(result.selected.length, 0);
  assert.equal(result.rejected[0].candidateReason, "below-candidate-threshold");
});

test("candidate selection enforces source and global body quotas", () => {
  const values = Array.from({ length: 50 }, (_, index) => item(String(index), {
    sourceId: `source-${Math.floor(index / 5)}`,
    source: `Source ${Math.floor(index / 5)}`,
    category: ["policy", "technology", "finance", "business", "macro", "international", "science", "security"][index % 8],
    title: `Official policy release ${index} includes unique subject ${index} and 2026 data`
  }));
  const result = selectCandidates(values, { rules });
  assert.ok(result.selected.length <= 36);
  const perSource = result.selected.reduce((counts, value) => ({ ...counts, [value.sourceId]: (counts[value.sourceId] || 0) + 1 }), {});
  assert.ok(Object.values(perSource).every((count) => count <= 5));
});

test("metadata preclassification uses canonical categories instead of source channels", () => {
  const classified = classifyMetadataCategory(item("macro", {
    category: "tech",
    title: "Central bank publishes inflation and interest rate data",
    summary: "The monetary policy report includes CPI and employment figures.",
    eventType: "economic_data"
  }));
  assert.equal(classified, "macro");
  assert.ok(CANONICAL_CATEGORIES.includes(classified));
});

test("related titles share a provisional event cluster", () => {
  const clustered = assignEventClusters([
    item("one", { title: "Regulator approves Acme AI safety policy", eventType: "policy_change" }),
    item("two", { title: "Acme AI safety policy approved by regulator", eventType: "policy_change" }),
    item("three", { title: "University reports a new battery study", eventType: "research_result" })
  ]);
  assert.equal(clustered[0].eventClusterKey, clustered[1].eventClusterKey);
  assert.notEqual(clustered[0].eventClusterKey, clustered[2].eventClusterKey);
});

test("candidate selection limits one event cluster to three independent sources", () => {
  const values = Array.from({ length: 5 }, (_, index) => item(`cluster-${index}`, {
    title: `Regulator approves Acme AI safety policy ${2026 + index}`,
    sourceId: `independent-${index}`,
    source: `Independent ${index}`
  }));
  const result = selectCandidates(values, { rules });
  assert.equal(result.selected.length, 3);
  assert.equal(result.rejected.filter((entry) => entry.candidateReason === "event-cluster-quota").length, 2);
});

test("body failure keeps only high-value metadata items", () => {
  const reviewed = reviewContent([
    item("high", { candidateValue: 80, bodyFetchStatus: "failed" }),
    item("low", { candidateValue: 70, bodyFetchStatus: "failed" })
  ], { metadataOnlyThreshold: 75, contentDensityThreshold: 55, officialContentDensityThreshold: 45 });
  assert.equal(reviewed.accepted[0].contentReviewStatus, "metadata-only");
  assert.equal(reviewed.rejected[0].id, "low");
});

test("classification covers canonical policy, security, science and business categories", () => {
  assert.equal(classifyLocally(item("policy", { title: "Government approves new industry regulation" })).category, "policy");
  assert.equal(classifyLocally(item("security", { title: "Critical software vulnerability triggers security incident", eventType: "security_incident" })).category, "security");
  assert.equal(classifyLocally(item("science", { title: "University publishes clinical research result", eventType: "research_result" })).category, "science");
  assert.equal(classifyLocally(item("business", { title: "Company earnings report shows revenue and profit", eventType: "earnings_guidance" })).category, "business");
});

test("classification reviews conflict items in one model batch and preserves ids", async () => {
  const calls = [];
  const inputs = [
    item("review-a", { title: "AI company raises financing for a new model", sourceCategory: "finance", eventType: "product_launch" }),
    item("review-b", { title: "AI company raises investment for a model product", sourceCategory: "finance", eventType: "product_launch" })
  ];
  const classified = await classifyItems(inputs, {
    llmProduction: { enabled: true, requiredSecret: "TEST_KEY", endpoint: "https://example.test", model: "test" }
  }, {
    env: { TEST_KEY: "local-test" },
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ items: inputs.map((entry) => ({ id: entry.id, category: "technology", secondaryTags: ["AI model"], confidence: 0.83, reason: "Core action is a technology release.", candidateConflicts: ["finance"] })) }) } }] })
      };
    }
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(classified.map((entry) => entry.id), inputs.map((entry) => entry.id));
  assert.ok(classified.every((entry) => entry.classification.method === "rule+llm-review"));
  assert.ok(classified.every((entry) => !entry.secondaryTags.includes("technology")));
});

test("source policy waits for minimum sample then degrades conservatively", () => {
  const now = new Date("2026-07-12T00:00:00.000Z");
  const runs = Array.from({ length: 5 }, (_, index) => ({ generatedAt: new Date(now.getTime() - index * 86400000).toISOString(), fetchedCount: 10, passedCount: 2, duplicateCount: 8, highValueCount: 0, bodyAttemptCount: 2, bodySuccessCount: 2, densityTotal: 120, densityCount: 2 }));
  const windows = metricsForWindows(runs, now);
  assert.equal(nextStatus({ status: "active" }, windows, runs, now).status, "reduced");
  const insufficient = metricsForWindows(runs.slice(0, 2), now);
  assert.equal(nextStatus({ status: "active" }, insufficient, runs.slice(0, 2), now).status, "active");
});

test("paused source recovers only after three successful actual probes", () => {
  const now = new Date("2026-07-12T00:00:00.000Z");
  const probe = (day) => ({ generatedAt: `2026-07-${day}T00:00:00.000Z`, fetchedCount: 2, highValueCount: 1, highValueRate: 0.5, bodyAttemptCount: 1, bodySuccessCount: 1, bodySuccessRate: 1, isProbe: true });
  const twoRuns = [probe("08"), probe("10")];
  const threeRuns = [...twoRuns, probe("12")];
  assert.equal(nextStatus({ status: "paused" }, metricsForWindows(twoRuns, now), twoRuns, now).status, "paused");
  assert.equal(nextStatus({ status: "paused" }, metricsForWindows(threeRuns, now), threeRuns, now).status, "limited");
});
