const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { readJson } = require("../scripts/lib/file-utils");
const {
  buildStructuredSummaryPrompt,
  validateStructuredSummary,
  buildExtractiveStructuredSummary,
  calculateImportanceScore
} = require("../scripts/lib/ai-summarizer");

test("structured summary prompt requires strict JSON and anti-hype rules", () => {
  const prompt = buildStructuredSummaryPrompt({
    title: "AI policy update",
    content: "Regulators published new disclosure rules.",
    source: "Official Source",
    publishedAt: "2026-06-10T00:00:00.000Z",
    url: "https://example.test/item"
  });

  assert.match(prompt, /strict valid JSON/);
  assert.match(prompt, /summary_short/);
  assert.match(prompt, /summary_points/);
  assert.match(prompt, /不得|Do not use unsupported hype words/);
});

test("structured summary validation strips unsupported hype terms", () => {
  const summary = validateStructuredSummary({
    summary_short: "这是重大更新，监管发布披露规则",
    summary_points: ["革命性变化", "监管发布规则"],
    key_data: ["10%"],
    why_it_matters: "影响披露流程",
    impact: "企业需要调整披露",
    risks: "执行细节不足以判断",
    neutrality_check: "只基于原文",
    confidence: "medium"
  });

  assert.equal(summary.summary_short.includes("重大"), false);
  assert.equal(summary.summary_points.some((point) => point.includes("革命性")), false);
  assert.equal(summary.confidence, "medium");
});

test("extractive structured summary keeps original url and importance score", () => {
  const item = {
    title: "SEC issues disclosure rule",
    contentExcerpt: "The SEC issued a disclosure rule. It applies to listed companies and includes a 30 day transition period.",
    source: "SEC",
    sourceAuthority: "official-agency",
    category: "finance",
    score: 88,
    url: "https://example.test/sec"
  };
  const summary = buildExtractiveStructuredSummary(item, "2026-06-10T00:00:00.000Z", "extractive");

  assert.equal(summary.original_url, item.url);
  assert.ok(summary.summary_short);
  assert.ok(Array.isArray(summary.summary_points));
  assert.ok(summary.importance_score >= 0 && summary.importance_score <= 100);
});

test("importance score rewards official sources, data, actions, and policy topics", () => {
  const official = calculateImportanceScore({
    title: "Central bank releases CPI policy data",
    summary: "CPI rose 2.5% and the central bank released policy guidance.",
    sourceAuthority: "official-agency",
    score: 80,
    impactAreas: ["macro"]
  });
  const generic = calculateImportanceScore({
    title: "Company blog roundup",
    summary: "A short product note.",
    sourceAuthority: "media",
    score: 80
  });

  assert.ok(official > generic);
});

test("at least five current real articles can produce structured fallback summaries", () => {
  const latest = readJson(path.join(__dirname, "..", "src", "data", "latest-items.json"), { items: [] });
  const sample = (latest.items || []).filter((item) => item.title && item.url).slice(0, 5);

  assert.equal(sample.length, 5);
  sample.forEach((item) => {
    const summary = buildExtractiveStructuredSummary(item, "2026-06-10T00:00:00.000Z", "extractive");
    assert.equal(summary.original_url, item.url);
    assert.ok(summary.summary_short);
    assert.ok(Array.isArray(summary.summary_points));
    assert.ok(Number.isFinite(summary.importance_score));
  });
});
