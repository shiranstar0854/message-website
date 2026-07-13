const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildDeepSeekRequestBody,
  buildDailySummaryOutput,
  buildItemSummaryRules,
  summarizeLatestData,
  summarizeLatestDataWithLlm
} = require("../scripts/generate-ai-summary");
const { articleBriefLength, buildLocalArticleBrief, validateArticleBrief } = require("../scripts/lib/article-brief");
const { dailyBriefLength } = require("../scripts/lib/daily-brief");
const {
  buildWeeklyReview,
  filterEnabledSourceItems,
  validateWeeklyResponse,
  weeklyTextLength
} = require("../scripts/generate-weekly-review");

test("daily summary frontend renders one article heading and continuous paragraphs", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "daily-summary.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "src", "scripts", "summary-pages.js"), "utf8");

  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.doesNotMatch(html, /<h[23]\b/);
  assert.doesNotMatch(script, /daily-event-entry[^\n]*<h3|section\("今日重点事件"/);
  assert.match(script, /dailyArticleParagraphs\(data\)\.map/);
});

function validArticleBrief(item) {
  return {
    schema_version: "article-brief.v1",
    title: "测试机构公布流程更新",
    core_fact: {
      summary: "测试机构正式公布流程更新，现有材料确认该主体已经发布安排，但尚未提供完整执行结果。该事实来自输入原文，当前不对未公布结果作确定判断。",
      participants: [item.source],
      time: "",
      location: ""
    },
    background: "本次更新与原文描述的既有工作流程直接相关。现有材料只说明此次公开动作及其背景，不补充原文之外的历史数据或外部原因。",
    key_data: [],
    current_progress: { stage: "announced", details: "相关主体已经正式公布安排，执行范围、完成时间和实际结果仍需后续材料确认。" },
    impact: {
      direct: "直接影响是相关使用者需要重新核对当前流程和公开条件；影响范围尚未由来源量化，因此不能写成已经发生的广泛结果。",
      medium_long_term: "中长期影响取决于后续执行、采用情况和独立证据，当前只能作为条件性观察，不能视为已经形成稳定趋势。"
    },
    stakeholder_positions: [],
    outlook: "后续需要观察正式执行文件、相关主体行动和可复核结果是否与当前公布方向一致。若没有新增证据，现有判断应保持有限。",
    risks_and_uncertainties: ["来源没有提供完整执行结果，也没有提供可核实的对立方观点。"],
    watch_variables: [{
      variable: "正式执行结果",
      confirmation_condition: "来源发布正式文件或可复核结果，且内容继续支持当前公布方向。",
      invalidation_condition: "正式文件、可复核结果或主体行动与当前公布方向相反。"
    }],
    sources: [{ name: item.source, url: item.url }],
    limitations: ["没有可核实的关键数据和多方态度，因此对应字段留空。"]
  };
}

function event(index, overrides = {}) {
  const names = ["政策部门", "技术机构", "市场机构", "研究机构", "安全机构"];
  return {
    event_id: `daily-${String(index).padStart(12, "a")}`,
    theme_key: `${overrides.category || "policy"}:policy_change:${names[index]}`,
    title: `${names[index]}发布新的可验证进展`,
    category: overrides.category || "policy",
    event_type: overrides.event_type || "policy_change",
    importance_score: 90 - index,
    summary: `${names[index]}发布一项新的正式进展，来源材料确认了主体、动作和当前阶段，但尚未提供完整执行结果。`,
    why_it_matters: "该进展可能改变相关主体的后续安排，重要性取决于正式执行和新增独立证据。",
    confirmed_facts: [{ text: `${names[index]}已经公开相关安排，当前只能确认公告内容和已披露进度。`, status: "confirmed" }],
    current_progress: { stage: "announced", details: "已经正式公布，尚待执行结果。" },
    watch_variables: [{ variable: `${names[index]}后续执行`, time_window: "未来7天", confirmation_condition: "出现正式执行文件", invalidation_condition: "正式文件撤回或方向相反", evidence_needed: ["正式文件"] }],
    entities: [names[index]],
    primary_source: { name: `${names[index]}官网`, url: `https://example.test/${index}` },
    supporting_sources: [],
    evidence_gaps: [{ gap: "尚未取得完整执行结果。" }],
    ...overrides
  };
}

test("extractive article summaries always include article-brief.v1", () => {
  const latest = { channels: {}, items: [{ id: "one", title: "测试机构更新", url: "https://example.test/one", source: "测试机构", category: "policy", score: 90, contentExcerpt: "测试机构正式发布一项流程更新，后续执行结果尚未公布。" }] };
  const output = summarizeLatestData(latest, { daily: { minimumScore: 60 } }, "2026-07-13T00:00:00.000Z");
  assert.equal(output.items[0].article_brief.schema_version, "article-brief.v1");
  assert.equal(output.items[0].article_brief.current_progress.stage, "announced");
});

test("article brief validator enforces length, entity, number and source whitelists", () => {
  const item = { title: "测试机构公布流程更新", source: "测试机构", url: "https://example.test/item", contentExcerpt: "测试机构公布流程更新。" };
  const brief = validArticleBrief(item);
  const validated = validateArticleBrief(brief, item);
  assert.ok(validated);
  assert.ok(articleBriefLength(validated) >= 350 && articleBriefLength(validated) <= 600);
  assert.equal(validateArticleBrief({ ...brief, core_fact: { ...brief.core_fact, participants: ["不存在的机构"] } }, item), null);
  assert.equal(validateArticleBrief({ ...brief, impact: { ...brief.impact, direct: `${brief.impact.direct} 新增999项。` } }, item), null);
  assert.equal(validateArticleBrief({ ...brief, sources: [{ name: "测试机构", url: "https://invalid.test" }] }, item), null);
});

test("all final feed items use the article model when configured", async () => {
  const items = [0, 1].map((index) => ({ id: `item-${index}`, title: "测试机构公布流程更新", url: `https://example.test/${index}`, source: "测试机构", category: "policy", score: 90, contentExcerpt: "测试机构正式公布流程更新，执行结果尚待确认。" }));
  const calls = [];
  const output = await summarizeLatestDataWithLlm({ channels: {}, items }, {
    llmProduction: { enabled: true, provider: "deepseek-chat-completions", endpoint: "https://api.deepseek.com/chat/completions", itemRequiredSecret: "DEEPSEEK_API_KEY1", maxRetries: 0 },
    daily: { minimumScore: 60 }
  }, "2026-07-13T00:00:00.000Z", {
    env: { DEEPSEEK_API_KEY1: "test-key" },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const input = items[calls.length - 1];
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ translatedTitle: "测试机构公布流程更新", summary_short: "测试机构已经公布流程更新。", summary_points: ["测试机构已经公布流程更新。"], why_it_matters: "后续执行结果可能影响相关流程。", impact: "影响取决于后续执行。", risks: "执行结果尚未公布。", neutrality_check: "仅使用输入材料。", confidence: "medium", article_brief: validArticleBrief(input) }) } }] }) };
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(output.summaryStats.llmSucceeded, 2);
  assert.ok(output.items.every((item) => item.article_brief?.schema_version === "article-brief.v1"));
});

test("article model failures retry and then use a local structured brief", async () => {
  let calls = 0;
  const output = await summarizeLatestDataWithLlm({ channels: {}, items: [{ id: "one", title: "测试机构更新", url: "https://example.test/one", source: "测试机构", category: "policy", score: 90, contentExcerpt: "测试机构正式公布流程更新。" }] }, {
    llmProduction: { enabled: true, endpoint: "https://api.deepseek.com/chat/completions", itemRequiredSecret: "DEEPSEEK_API_KEY1", maxRetries: 0 }, daily: { minimumScore: 60 }
  }, "2026-07-13T00:00:00.000Z", { env: { DEEPSEEK_API_KEY1: "test-key" }, fetchImpl: async () => { calls += 1; return { ok: false, status: 500, text: async () => "failed" }; } });
  assert.equal(calls, 2);
  assert.equal(output.summaryStats.fallbackCount, 1);
  assert.equal(output.items[0].article_brief.schema_version, "article-brief.v1");
});

test("daily brief v6 uses three to five internal events and exact public fields", async () => {
  const output = await buildDailySummaryOutput({ items: [event(0), event(1, { category: "technology" }), event(2, { category: "finance" })] }, { llmProduction: { enabled: false } }, "2026-07-13T00:00:00.000Z", { env: {} });
  assert.equal(output.schema_version, "daily-brief.v6");
  assert.equal(output.core_events.length, 3);
  assert.ok(output.daily_thesis.headline && output.daily_thesis.summary);
  assert.ok(Array.isArray(output.cross_event_links));
  assert.ok(output.follow_up_watch.every((row) => row.confirmation_condition && row.invalidation_condition));
  assert.equal(output.tomorrow_focus.length, 0);
  assert.ok(dailyBriefLength(output) >= 700 || output.limitations.some((row) => row.includes("目标篇幅")));
});

test("daily brief omits unsupported key data and schedules", async () => {
  const output = await buildDailySummaryOutput({ items: [event(0), event(1), event(2)] }, { llmProduction: { enabled: false } }, "2026-07-13T00:00:00.000Z", { env: {} });
  assert.deepEqual(output.key_data, []);
  assert.deepEqual(output.tomorrow_focus, []);
  assert.ok(output.limitations.some((row) => row.includes("关键数据")));
});

test("weekly review v3 exposes the specified fields and stable judgment ids", () => {
  const currentEvents = [event(0), event(1, { category: "technology", event_type: "product_launch" }), event(2, { category: "finance", event_type: "market_move" })];
  const first = buildWeeklyReview([{ date: "2026-07-12", generatedAt: "2026-07-12T00:00:00.000Z", events: currentEvents }], {}, "2026-07-13T00:00:00.000Z");
  const previous = { schema_version: "weekly-review.v3", major_events: [], category_trends: first.category_trends };
  const second = buildWeeklyReview([{ date: "2026-07-12", generatedAt: "2026-07-12T00:00:00.000Z", events: currentEvents }], {}, "2026-07-13T00:00:00.000Z", previous);
  const fields = ["week_range", "weekly_thesis", "major_events", "category_trends", "key_data_changes", "cross_event_links", "market_policy_feedback", "previous_week_validation", "cognitive_updates", "new_signals", "risks_and_uncertainties", "personal_implications", "next_week_watchlist", "sources", "limitations"];
  assert.equal(first.schema_version, "weekly-review.v3");
  assert.ok(fields.every((field) => first[field] !== undefined));
  assert.equal(second.category_trends[0].judgment_id, first.category_trends[0].judgment_id);
  assert.ok(second.next_week_watchlist.every((row) => row.observation && row.confirmation_condition && row.invalidation_condition && row.evidence_needed.length));
  assert.ok(weeklyTextLength(first) >= 1200 || first.limitations.some((row) => row.includes("目标篇幅")));
});

test("weekly model validation rejects invented judgment ids", () => {
  const base = buildWeeklyReview([{ date: "2026-07-12", generatedAt: "2026-07-12T00:00:00.000Z", events: [event(0), event(1), event(2)] }], {}, "2026-07-13T00:00:00.000Z");
  const response = JSON.parse(JSON.stringify(base));
  response.next_week_watchlist[0].judgment_id = "judgment-ffffffffffff";
  assert.equal(validateWeeklyResponse(base, response), null);
});

test("weekly source filter excludes disabled sources", () => {
  const filtered = filterEnabledSourceItems([{ sourceId: "enabled", source: "Enabled" }, { sourceId: "disabled", source: "Disabled" }], [{ id: "enabled", name: "Enabled", enabled: true }, { id: "disabled", name: "Disabled", enabled: false }]);
  assert.equal(filtered.length, 1);
});

test("article summaries use the item secret and DeepSeek JSON mode", () => {
  const rules = { llmProduction: { enabled: true, model: "deepseek-v4-flash", requiredSecret: "DEEPSEEK_API_KEY", itemRequiredSecret: "DEEPSEEK_API_KEY1" } };
  assert.equal(buildItemSummaryRules(rules).llmProduction.requiredSecret, "DEEPSEEK_API_KEY1");
  const body = buildDeepSeekRequestBody("Return JSON", rules, {});
  assert.equal(body.model, "deepseek-v4-flash");
  assert.equal(body.response_format.type, "json_object");
});

test("local article fallback leaves unsupported fields empty", () => {
  const brief = buildLocalArticleBrief({ title: "测试机构更新", source: "测试机构", url: "https://example.test/local", contentExcerpt: "测试机构公布更新。" });
  assert.equal(brief.core_fact.location, "");
  assert.deepEqual(brief.key_data, []);
  assert.deepEqual(brief.stakeholder_positions, []);
  assert.ok(brief.limitations.length >= 3);
});
