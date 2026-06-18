const test = require("node:test");
const assert = require("node:assert/strict");
const {
  analyzeEventsData,
  buildEventAnalysisPrompt,
  validateEventAnalysis
} = require("../scripts/generate-event-analysis");

const sampleEvent = {
  id: "event-1",
  event_id: "event-1",
  title: "AI 政策更新",
  summary: "监管机构发布 AI 治理规则。",
  one_sentence_summary: "监管机构发布 AI 治理规则。",
  decisionBrief: "需要继续跟踪执行细则。",
  decisionLane: "china_us_ai",
  decisionGrade: "A",
  confidence_level: "中",
  confirmed_facts: ["监管机构发布规则"],
  impact_analysis: {
    market: "关注 AI 链条反应。",
    industry: "影响 AI 治理。",
    company: "目前证据不足",
    user: "目前证据不足"
  },
  uncertainties: ["执行细则仍需观察"],
  watch_variables: ["后续官方问答"],
  timeline: [{
    date: "2026-06-18",
    title: "AI 政策发布",
    summary: "监管机构发布规则。",
    source: "官方来源",
    url: "https://example.test/rule"
  }],
  related_articles: [{
    title: "AI 政策发布",
    source: "官方来源",
    url: "https://example.test/rule"
  }]
};

test("event analysis prompt asks for event-level structured JSON", () => {
  const prompt = buildEventAnalysisPrompt(sampleEvent);
  assert.match(prompt, /what_happened/);
  assert.match(prompt, /tracking_decision/);
  assert.match(prompt, /只基于输入材料/);
  assert.match(prompt, /AI 政策更新/);
});

test("event analysis validation normalizes analysis fields", () => {
  const analysis = validateEventAnalysis({
    what_happened: "监管机构发布 AI 治理规则。",
    confirmed_facts: ["监管机构发布规则"],
    what_changed: "后续执行细则成为观察重点。",
    impact_analysis: { market: "市场关注 AI 链条。", industry: "影响 AI 治理。" },
    uncertainties: ["执行时间表未完全明确"],
    watch_variables: ["官方问答"],
    tracking_decision: "值得追踪",
    confidence_level: "高",
    source_links: [{ title: "原文", url: "https://example.test/rule" }],
    analysis_notes: ["基于官方来源"],
    my_questions: ["是否会发布实施细则？"]
  }, sampleEvent);

  assert.equal(analysis.tracking_decision, "值得追踪");
  assert.equal(analysis.confidence_level, "高");
  assert.equal(analysis.impact_analysis.company, "目前证据不足");
  assert.equal(analysis.source_links[0].url, "https://example.test/rule");
});

test("event LLM analysis updates event fields and records stats", async () => {
  const data = { generatedAt: "2026-06-18T00:00:00.000Z", events: [sampleEvent] };
  const analyzed = await analyzeEventsData(data, {
    llmProduction: {
      enabled: true,
      endpoint: "https://api.deepseek.com/chat/completions",
      provider: "deepseek-chat-completions",
      model: "deepseek-test",
      requiredSecret: "DEEPSEEK_API_KEY"
    }
  }, "2026-06-18T01:00:00.000Z", {
    env: { DEEPSEEK_API_KEY: "test-key" },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              what_happened: "监管机构发布 AI 治理规则。",
              confirmed_facts: ["监管机构发布规则"],
              what_changed: "后续执行细则成为观察重点。",
              impact_analysis: {
                market: "市场关注 AI 链条。",
                industry: "影响 AI 治理。",
                company: "目前证据不足",
                user: "目前证据不足"
              },
              uncertainties: ["执行时间表未完全明确"],
              watch_variables: ["官方问答"],
              tracking_decision: "值得追踪",
              confidence_level: "高",
              source_links: [{ title: "原文", url: "https://example.test/rule" }],
              analysis_notes: ["基于官方来源"],
              my_questions: ["是否会发布实施细则？"]
            })
          }
        }]
      })
    })
  });

  assert.equal(analyzed.eventAnalysisStats.llmAttempted, 1);
  assert.equal(analyzed.eventAnalysisStats.llmSucceeded, 1);
  assert.equal(analyzed.events[0].llm_analysis_status, "succeeded");
  assert.equal(analyzed.events[0].tracking_decision, "值得追踪");
  assert.equal(analyzed.events[0].summary, "监管机构发布 AI 治理规则。");
  assert.equal(analyzed.events[0].related_articles[0].url, "https://example.test/rule");
});

test("event LLM analysis writes fallback analysis when the model response fails", async () => {
  const data = { generatedAt: "2026-06-18T00:00:00.000Z", events: [sampleEvent] };
  const analyzed = await analyzeEventsData(data, {
    llmProduction: {
      enabled: true,
      endpoint: "https://api.deepseek.com/chat/completions",
      provider: "deepseek-chat-completions",
      model: "deepseek-test",
      requiredSecret: "DEEPSEEK_API_KEY"
    }
  }, "2026-06-18T01:00:00.000Z", {
    env: { DEEPSEEK_API_KEY: "test-key" },
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      text: async () => "model unavailable"
    })
  });

  assert.equal(analyzed.eventAnalysisStats.llmAttempted, 1);
  assert.equal(analyzed.eventAnalysisStats.llmSucceeded, 0);
  assert.equal(analyzed.eventAnalysisStats.fallbackCount, 1);
  assert.equal(analyzed.events[0].llm_analysis_status, "fallback");
  assert.ok(analyzed.events[0].llm_analysis);
  assert.equal(analyzed.events[0].llm_analysis_model, "extractive");
});
