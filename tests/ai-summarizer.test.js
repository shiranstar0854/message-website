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
  assert.match(prompt, /translatedTitle/);
  assert.match(prompt, /what_happened/);
  assert.match(prompt, /confirmed_facts/);
  assert.match(prompt, /impact_analysis/);
  assert.match(prompt, /tracking_decision/);
  assert.match(prompt, /summary_short/);
  assert.match(prompt, /summary_points/);
  assert.match(prompt, /analytical Chinese paragraphs/);
  assert.match(prompt, /2-4 complete sentences/);
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
    impact_analysis: {
      market: "目前证据不足",
      industry: "企业需要调整披露",
      company: "目前证据不足",
      user: "目前证据不足"
    },
    tracking_decision: "暂时观察",
    confidence_level: "中",
    neutrality_check: "只基于原文",
    confidence: "medium"
  });

  assert.equal(summary.summary_short.includes("重大"), false);
  assert.equal(summary.summary_points.some((point) => point.includes("革命性")), false);
  assert.equal(summary.confidence, "medium");
  assert.equal(summary.confidence_level, "中");
  assert.equal(summary.tracking_decision, "暂时观察");
  assert.equal(summary.impact_analysis.industry, "企业需要调整披露");
});

test("structured summary validation accepts event analysis fields", () => {
  const summary = validateStructuredSummary({
    what_happened: "监管机构发布披露规则。",
    confirmed_facts: ["规则由监管机构发布", "适用于上市公司"],
    what_changed: "披露流程需要按新规则调整。",
    impact_analysis: {
      market: "可能影响投资者对披露质量的判断。",
      industry: "上市公司需要调整披露流程。",
      company: "相关公司需要检查合规安排。",
      user: "普通用户影响目前证据不足。"
    },
    uncertainties: ["执行细节仍需后续文件确认"],
    watch_variables: ["过渡期安排", "公司披露模板"],
    tracking_decision: "值得追踪",
    confidence_level: "高",
    source_links: [{ title: "原文", url: "https://example.test/rule" }]
  });

  assert.equal(summary.summary_short, "监管机构发布披露规则。");
  assert.deepEqual(summary.summary_points, ["规则由监管机构发布", "适用于上市公司"]);
  assert.equal(summary.why_it_matters, "披露流程需要按新规则调整。");
  assert.equal(summary.confidence, "high");
  assert.equal(summary.source_links[0].url, "https://example.test/rule");
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
  assert.ok(summary.what_happened);
  assert.ok(Array.isArray(summary.confirmed_facts));
  assert.ok(summary.impact_analysis);
  assert.ok(Array.isArray(summary.uncertainties));
  assert.ok(Array.isArray(summary.watch_variables));
  assert.ok(["值得追踪", "暂时观察", "不值得追踪"].includes(summary.tracking_decision));
  assert.ok(["高", "中", "低"].includes(summary.confidence_level));
  assert.equal(summary.source_links[0].url, item.url);
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
