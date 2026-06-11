const test = require("node:test");
const assert = require("node:assert/strict");

const {
  renderTopHotspots,
  renderTopEvents,
  selectTopEvents,
  selectTopHotspots
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
  assert.match(html, /重要度：高/);
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

test("static homepage renders event tracking block with timeline fields", () => {
  const html = renderTopEvents([{
    title: "AI 政策与基础设施",
    summary: "发生了新的 AI 治理讨论。",
    whyItMatters: "影响企业 AI 投入和监管预期。",
    impactAreas: ["AI政策", "监管"],
    watchlist: ["跟踪监管文本", "观察企业反应"],
    updatedAt: "2026-06-02T00:00:00.000Z",
    itemCount: 3,
    heat: "高",
    timeline: [
      {
        date: "2026-06-01",
        title: "首次传出合作消息",
        summary: "双方开始接触。",
        source: "Official Source",
        score: 90
      },
      {
        date: "2026-06-02",
        title: "公司回应仍在谈判",
        summary: "合作细节未定。",
        source: "Reuters",
        score: 91
      }
    ]
  }]);

  assert.match(html, /home-event-list/);
  assert.match(html, /热度：高/);
  assert.match(html, /发生了新的 AI 治理讨论/);
  assert.match(html, /首次传出合作消息/);
  assert.match(html, /公司回应仍在谈判/);
  assert.match(html, /查看事件追踪/);
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
