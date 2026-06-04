const test = require("node:test");
const assert = require("node:assert/strict");

const {
  renderTopHotspots,
  selectTopHotspots
} = require("../scripts/generate-static-index");

test("static homepage selects Top 5 by score then publish time", () => {
  const items = [
    { id: "low", title: "Low", score: 80, publishedAt: "2026-06-01T00:00:00.000Z" },
    { id: "older", title: "Older", score: 100, publishedAt: "2026-06-01T00:00:00.000Z" },
    { id: "newer", title: "Newer", score: 100, publishedAt: "2026-06-02T00:00:00.000Z" },
    { id: "mid-1", title: "Mid 1", score: 95, publishedAt: "2026-06-01T00:00:00.000Z" },
    { id: "mid-2", title: "Mid 2", score: 94, publishedAt: "2026-06-01T00:00:00.000Z" },
    { id: "mid-3", title: "Mid 3", score: 93, publishedAt: "2026-06-01T00:00:00.000Z" }
  ];

  const selected = selectTopHotspots(items);

  assert.deepEqual(selected.map((item) => item.id), ["newer", "older", "mid-1", "mid-2", "mid-3"]);
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
    impactAreas: ["AI政策", "地缘政治"],
    sourceLanguage: "en"
  }]);

  assert.match(html, /Top 1/);
  assert.match(html, /OpenAI 更新政策观点/);
  assert.match(html, /中文摘要优先展示/);
  assert.match(html, /重要性/);
  assert.match(html, /AI政策/);
  assert.match(html, /原文入口/);
  assert.match(html, /top-hotspot-card is-primary/);
});
