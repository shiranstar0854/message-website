const test = require("node:test");
const assert = require("node:assert/strict");
const {
  analyzeEventsData,
  buildEventAnalysisPrompt,
  buildEventContext,
  buildFactExtractionPrompt,
  normalizeEventAnalysis,
  normalizeFactExtraction,
  scoreAnalysisQuality
} = require("../scripts/generate-event-analysis");

const sampleEvent = {
  event_id: "event-1",
  title: "AI 政策更新",
  lane_id: "china_us_ai",
  lane_label: "中美 AI 发展",
  status: "active",
  priority_grade: "A",
  updated_at: "2026-06-18T00:00:00.000Z",
  definition: {
    one_sentence: "监管机构发布 AI 治理规则。",
    background: "监管机构发布 AI 治理规则。",
    why_it_matters: "需要继续跟踪执行细则。"
  },
  decision: {
    signal: "优先跟踪",
    brief: "需要继续跟踪执行细则。"
  },
  evidence: {
    confidence_basis: "中",
    source_links: [{
      title: "AI 政策发布",
      source: "官方来源",
      url: "https://example.test/rule"
    }]
  },
  confirmed_facts: [{
    fact: "监管机构发布规则",
    evidence_url: "https://example.test/rule"
  }],
  impact: {
    market: { impact: "关注 AI 链条反应。" },
    industry: { impact: "影响 AI 治理。" },
    company: { impact: "目前证据不足" },
    user_or_developer: { impact: "目前证据不足" }
  },
  uncertainties: ["执行细则仍需观察"],
  watch_variables: [
    { variable: "官方问答" },
    { variable: "实施时间" },
    { variable: "企业反馈" }
  ],
  timeline: [{
    date: "2026-06-18",
    title: "AI 政策发布",
    summary: "监管机构发布规则。",
    source: "官方来源",
    url: "https://example.test/rule"
  }],
  related_items: [{
    title: "AI 政策发布",
    source: "官方来源",
    url: "https://example.test/rule"
  }]
};

function factResponse() {
  return {
    confirmed_facts: ["监管机构发布规则"],
    key_entities: ["监管机构", "AI 企业"],
    time_info: "2026-06-18",
    source_type: "official_announcement",
    evidence_links: [{ title: "原文", source: "官方来源", url: "https://example.test/rule" }],
    new_information: "信息从讨论进入官方规则发布阶段。",
    missing_information: ["执行细则仍未完全明确"],
    possible_opinions: ["市场可能重新评估 AI 治理成本"],
    unsupported_claims: []
  };
}

function analysisResponse() {
  return {
    core_change: "事件从讨论阶段进入官方规则发布阶段。",
    confirmed_facts: ["监管机构发布规则"],
    impact_analysis: {
      market: "市场可能重新评估 AI 治理成本。",
      industry: "AI 企业需要关注合规流程。",
      company: "目前证据不足，暂不判断单个公司影响。",
      user_or_developer: "开发者需要关注后续接口和合规要求。"
    },
    forward_looking_scenarios: [
      {
        scenario: "执行细则快速落地",
        condition: "监管机构发布问答和时间表。",
        possible_result: "企业合规成本更明确。",
        confidence: "中"
      },
      {
        scenario: "执行细则延后",
        condition: "后续没有配套规则。",
        possible_result: "市场影响停留在预期层面。",
        confidence: "中"
      }
    ],
    risk_factors: [
      { risk: "原文信息可能不完整", type: "信息风险", reason: "需要核对后续官方问答。" },
      { risk: "市场可能过度解读", type: "市场风险", reason: "目前没有直接市场数据。" },
      { risk: "执行细节可能改变影响", type: "执行风险", reason: "实施时间仍待确认。" }
    ],
    counter_arguments: [
      "如果规则只是原则性表述，实际影响可能有限。",
      "如果企业已有合规流程，新增成本可能低于预期。"
    ],
    watch_variables: ["官方问答", "实施时间", "企业反馈"],
    judgment_update: "部分修正原有判断",
    tracking_decision: "值得追踪",
    confidence_level: "高",
    confidence_reason: "有官方来源，但执行细则仍需观察。",
    source_links: [{ title: "原文", source: "官方来源", url: "https://example.test/rule" }]
  };
}

test("event context carries background, latest article, timeline and watch variables", () => {
  const context = buildEventContext(sampleEvent);
  assert.equal(context.event_id, "event-1");
  assert.equal(context.event_title, "AI 政策更新");
  assert.equal(context.latest_article.url, "https://example.test/rule");
  assert.equal(context.related_facts[0], "监管机构发布规则");
  assert.equal(context.previous_timeline.length, 1);
  assert.equal(context.watch_variables.length, 3);
});

test("fact extraction prompt receives event_context and asks for facts only", () => {
  const context = buildEventContext(sampleEvent);
  const prompt = buildFactExtractionPrompt(context);
  assert.match(prompt, /event_context/);
  assert.match(prompt, /只提取事实/);
  assert.match(prompt, /unsupported_claims/);
});

test("fact extraction validation separates facts, opinions and unsupported claims", () => {
  const context = buildEventContext(sampleEvent);
  const facts = normalizeFactExtraction({
    ...factResponse(),
    possible_opinions: ["市场可能重新评估 AI 治理成本"],
    unsupported_claims: ["将立即改变行业格局"]
  }, context);
  assert.deepEqual(facts.confirmed_facts, ["监管机构发布规则"]);
  assert.equal(facts.possible_opinions.length, 1);
  assert.equal(facts.unsupported_claims.length, 1);
  assert.equal(facts.evidence_links[0].url, "https://example.test/rule");
});

test("event analysis prompt uses fact extraction and event_context", () => {
  const context = buildEventContext(sampleEvent);
  const prompt = buildEventAnalysisPrompt(context, factResponse());
  assert.match(prompt, /fact_extraction/);
  assert.match(prompt, /core_change/);
  assert.match(prompt, /forward_looking_scenarios/);
  assert.match(prompt, /counter_arguments/);
});

test("event analysis validation produces deep analysis structure", () => {
  const context = buildEventContext(sampleEvent);
  const analysis = normalizeEventAnalysis(analysisResponse(), context, factResponse());
  assert.equal(analysis.core_change, "事件从讨论阶段进入官方规则发布阶段。");
  assert.equal(analysis.forward_looking_scenarios.length, 2);
  assert.equal(analysis.risk_factors.length, 3);
  assert.equal(analysis.counter_arguments.length, 2);
  assert.equal(analysis.watch_variables.length, 3);
  assert.equal(analysis.confidence_reason, "有官方来源，但执行细则仍需观察。");
});

test("analysis quality score marks complete analysis as core", () => {
  const context = buildEventContext(sampleEvent);
  const analysis = normalizeEventAnalysis(analysisResponse(), context, factResponse());
  const quality = scoreAnalysisQuality(analysis, factResponse());
  assert.equal(quality.analysis_quality_score, 100);
  assert.deepEqual(quality.quality_flags, []);
  assert.equal(quality.is_core_analysis, true);
});

test("analysis quality score filters shallow analysis", () => {
  const context = buildEventContext(sampleEvent);
  const analysis = normalizeEventAnalysis({
    core_change: "监管机构发布规则。",
    confirmed_facts: ["监管机构发布规则"],
    impact_analysis: {},
    source_links: [{ url: "https://example.test/rule" }]
  }, context, factResponse());
  const quality = scoreAnalysisQuality(analysis, factResponse());
  assert.equal(quality.is_core_analysis, false);
  assert.ok(quality.analysis_quality_score < 80);
  assert.ok(quality.quality_flags.includes("没有风险因素"));
});

test("event LLM analysis runs fact extraction then event analysis and stores analysis_notes", async () => {
  const data = { generatedAt: "2026-06-18T00:00:00.000Z", events: [sampleEvent] };
  const calls = [];
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
    fetchImpl: async (_url, request) => {
      calls.push(JSON.parse(request.body).messages.at(-1).content);
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify(calls.length === 1 ? factResponse() : analysisResponse())
            }
          }]
        })
      };
    }
  });

  assert.equal(calls.length, 2);
  assert.equal(analyzed.meta.stats.event_analysis.llmAttempted, 1);
  assert.equal(analyzed.meta.stats.event_analysis.llmSucceeded, 1);
  const event = analyzed.events[0];
  assert.equal(event.analysis_notes.length, 1);
  assert.equal(event.analysis_notes[0].quality.is_core_analysis, true);
  assert.equal(event.analysis_notes[0].quality.score, 100);
  assert.equal(event.analysis_notes[0].model.status, "succeeded");
  assert.equal(event.analysis_notes[0].analysis.core_change, "事件从讨论阶段进入官方规则发布阶段。");
  assert.equal(event.analysis_notes[0].quality.score, 100);
  assert.equal(event.analysis_notes[0].fact_extraction.confirmed_facts[0], "监管机构发布规则");
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

  assert.equal(analyzed.meta.stats.event_analysis.llmAttempted, 1);
  assert.equal(analyzed.meta.stats.event_analysis.llmSucceeded, 0);
  assert.equal(analyzed.meta.stats.event_analysis.fallbackCount, 1);
  assert.ok(analyzed.events[0].analysis_notes[0].fact_extraction);
  assert.equal(analyzed.events[0].analysis_notes[0].model.status, "fallback");
  assert.ok(analyzed.events[0].analysis_notes[0].quality);
  assert.equal(analyzed.events[0].analysis_notes[0].quality.is_core_analysis, false);
  assert.ok(analyzed.events[0].analysis_notes[0].quality.score < 80);
  assert.ok(analyzed.events[0].analysis_notes[0].quality.flags.some((flag) => flag.includes("兜底分析")));
  assert.equal(analyzed.events[0].analysis_notes[0].model.name, "extractive");
});
