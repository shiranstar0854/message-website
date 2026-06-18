const test = require("node:test");
const assert = require("node:assert/strict");

const {
  renderTopHotspots,
  renderTopEvents,
  selectTopEvents,
  selectTopHotspots,
  topScoreBreakdown
} = require("../scripts/generate-static-index");

test("static homepage selects Top 5 by importance_score then publish time", () => {
  const items = [
    { id: "low", title: "Low", score: 100, importance_score: 80, publishedAt: "2026-06-01T00:00:00.000Z" },
    { id: "older", title: "Older", score: 80, importance_score: 100, publishedAt: "2026-06-01T00:00:00.000Z" },
    { id: "newer", title: "Newer", score: 80, importance_score: 100, publishedAt: "2026-06-02T00:00:00.000Z" },
    { id: "mid-1", title: "Mid 1", score: 80, importance_score: 95, publishedAt: "2026-06-01T00:00:00.000Z" },
    { id: "mid-2", title: "Mid 2", score: 80, importance_score: 94, publishedAt: "2026-06-01T00:00:00.000Z" },
    { id: "mid-3", title: "Mid 3", score: 80, importance_score: 93, publishedAt: "2026-06-01T00:00:00.000Z" }
  ];

  const selected = selectTopHotspots(items);

  assert.deepEqual(selected.map((item) => item.id), ["newer", "older", "mid-1", "mid-2", "mid-3"]);
});

test("static homepage avoids duplicate hotspot event keys", () => {
  const selected = selectTopHotspots([
    { id: "ai-a", title: "AI policy first", score: 100, publishedAt: "2026-06-02T00:00:00.000Z", impactAreas: ["AI政策"] },
    { id: "ai-b", title: "AI policy second", score: 99, publishedAt: "2026-06-02T01:00:00.000Z", impactAreas: ["AI政策"] },
    { id: "macro", title: "Macro update", score: 90, publishedAt: "2026-06-01T00:00:00.000Z", impactAreas: ["宏观"] }
  ]);

  assert.deepEqual(selected.map((item) => item.id), ["ai-a", "macro"]);
});

test("static homepage prefers readable hotspots when scores are close", () => {
  const selected = selectTopHotspots([
    { id: "score-only", title: "Score only", score: 91, publishedAt: "2026-06-01T00:00:00.000Z" },
    { id: "readable", title: "Readable", score: 90, publishedAt: "2026-06-01T00:00:00.000Z", aiSummary: "Readable summary", importance: "Important" }
  ]);

  assert.equal(selected[0].id, "readable");
});

test("static homepage ranks Top 5 by event importance score over article score alone", () => {
  const sourceOnly = {
    id: "source-only",
    title: "Official daily update",
    score: 100,
    importance_score: 96,
    sourceAuthority: "official-agency",
    publishedAt: "2026-06-02T00:00:00.000Z"
  };
  const eventLike = {
    id: "event-like",
    title: "AI policy creates market and developer follow-up questions",
    score: 82,
    importance_score: 82,
    sourceAuthority: "official-media",
    duplicateCount: 3,
    impactAreas: ["AI政策", "监管", "市场"],
    key_data: ["企业支出", "监管回应"],
    why_it_matters: "影响 AI 投入和监管预期。",
    impact: "影响重要公司、开发者和市场判断。",
    risks: "等待后续政策文本确认。",
    timeline_event_id: "ai-policy",
    confidence: "high",
    category: "tech",
    publishedAt: "2026-06-02T00:00:00.000Z"
  };

  const selected = selectTopHotspots([sourceOnly, eventLike], 2);

  assert.equal(selected[0].id, "event-like");
  assert.ok(topScoreBreakdown(eventLike).top_score > topScoreBreakdown(sourceOnly).top_score);
});

test("static homepage excludes C and D tier sources from Top 5", () => {
  const selected = selectTopHotspots([
    {
      id: "social",
      title: "Social discussion claims AI market shift",
      score: 100,
      importance_score: 100,
      sourceTier: "C",
      publishedAt: "2026-06-02T00:00:00.000Z"
    },
    {
      id: "marketing",
      title: "Sponsored AI market claim",
      score: 100,
      importance_score: 100,
      sourceTier: "D",
      publishedAt: "2026-06-02T00:00:00.000Z"
    },
    {
      id: "official",
      title: "Official AI policy data release",
      score: 80,
      importance_score: 80,
      sourceTier: "S",
      publishedAt: "2026-06-02T00:00:00.000Z"
    }
  ], 5);

  assert.deepEqual(selected.map((item) => item.id), ["official"]);
});

test("static homepage renders Top 5 block with Chinese summary fallback", () => {
  const html = renderTopHotspots([{
    title: "OpenAI update",
    url: "https://example.test/openai",
    source: "OpenAI News",
    category: "tech",
    publishedAt: "2026-06-02T00:00:00.000Z",
    score: 99,
    translatedTitle: "OpenAI 更新政策观点",
    aiSummary: "中文摘要优先展示。",
    importance: "影响 AI 政策讨论。",
    impactAreas: ["AI政策", "地缘政治", "消费电子"],
    sourceLanguage: "en"
  }]);

  assert.match(html, /#1/);
  assert.match(html, /OpenAI 更新政策观点/);
  assert.match(html, /中文摘要优先展示/);
  assert.match(html, /影响 AI 政策讨论/);
  assert.match(html, /来源：OpenAI News/);
  assert.match(html, /重要度：中/);
  assert.match(html, /Top分：60/);
  assert.match(html, /top-hotspot-link/);
  assert.match(html, /top-hotspot-card top-hotspot-row is-primary/);
});

test("static homepage renders summaries and source meta for non-primary hotspots", () => {
  const html = renderTopHotspots([
    {
      title: "Primary",
      url: "https://example.test/primary",
      source: "Primary Source",
      category: "tech",
      publishedAt: "2026-06-02T00:00:00.000Z",
      score: 99,
      summary: "Primary summary"
    },
    {
      title: "Second",
      url: "https://example.test/second",
      source: "Second Source",
      category: "news",
      publishedAt: "2026-06-01T00:00:00.000Z",
      score: 88,
      summary: "Second summary"
    }
  ]);

  assert.match(html, /Second summary/);
  assert.match(html, /来源：Second Source/);
  assert.match(html, /更新时间：/);
});

test("static homepage renders empty Top 5 state", () => {
  const html = renderTopHotspots([]);

  assert.match(html, /top-hotspot-list/);
  assert.match(html, /compact-empty/);
});

test("static homepage renders event tracking cards with MVP fields and detail links", () => {
  const html = renderTopEvents([{
    id: "openai-model-race",
    event_id: "openai-model-race",
    title: "OpenAI / AI 模型竞争",
    one_sentence_summary: "模型竞争进入持续追踪阶段。",
    current_status: "持续追踪",
    latest_change: "等待最新信息更新",
    importance_level: "高",
    confidence_level: "中",
    last_updated: "2026-06-18",
    itemCount: 3,
    heat: "高"
  }]);

  assert.match(html, /home-event-list/);
  assert.match(html, /OpenAI \/ AI 模型竞争/);
  assert.match(html, /当前状态/);
  assert.match(html, /持续追踪/);
  assert.match(html, /最新变化/);
  assert.match(html, /等待最新信息更新/);
  assert.match(html, /重要性/);
  assert.match(html, /置信度/);
  assert.match(html, /更新时间/);
  assert.match(html, /event\.html\?id=openai-model-race/);
  assert.match(html, /查看追踪/);
});

test("static homepage sorts event hotspots by explanation and evidence strength", () => {
  const selected = selectTopEvents([{
    id: "thin",
    updatedAt: "2026-06-02T00:00:00.000Z",
    itemCount: 1,
    evidenceItems: [{ score: 90 }]
  }, {
    id: "explained",
    updatedAt: "2026-06-02T00:00:00.000Z",
    whyItMatters: "Important",
    watchlist: ["Next"],
    impactAreas: ["AI"],
    itemCount: 4,
    evidenceItems: [{ score: 89 }]
  }]);

  assert.equal(selected[0].id, "explained");
});
