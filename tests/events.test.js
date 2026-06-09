const test = require("node:test");
const assert = require("node:assert/strict");

const { buildEvents } = require("../scripts/generate-events");

test("buildEvents groups related high-value items into event clusters", () => {
  const data = buildEvents([
    {
      id: "ai-1",
      title: "AI regulation update",
      summary: "New AI safety framework.",
      source: "Source A",
      category: "tech",
      publishedAt: "2026-06-01T00:00:00.000Z",
      score: 92,
      article_keywords: ["AI政策"]
    },
    {
      id: "ai-2",
      title: "Artificial intelligence policy hearing",
      summary: "Lawmakers discuss model governance.",
      source: "Source B",
      category: "news",
      publishedAt: "2026-06-04T01:00:00.000Z",
      score: 90,
      keywords: ["AI政策"]
    },
    {
      id: "single",
      title: "One-off company update",
      summary: "Company revenue update.",
      source: "Source C",
      category: "business",
      publishedAt: "2026-06-02T02:00:00.000Z",
      score: 95,
      keywords: ["财报"]
    }
  ], "2026-06-02T03:00:00.000Z");

  assert.equal(data.totalEvents, 1);
  assert.equal(data.events[0].id, "ai-policy-ai政策");
  assert.equal(data.events[0].itemCount, 2);
  assert.deepEqual(data.events[0].items.map((item) => item.id), ["ai-1", "ai-2"]);
  assert.equal(data.events[0].latestUpdate.title, "Artificial intelligence policy hearing");
  assert.equal(data.events[0].primarySource, "Source B");
  assert.equal(data.events[0].sourceCount, 2);
  assert.deepEqual(data.events[0].keyDevelopments.map((item) => item.date), ["2026-06-01", "2026-06-04"]);
  assert.ok(data.events[0].whyItMatters);
  assert.ok(data.events[0].impactAreas.length > 0);
  assert.equal(data.events[0].watchlist.length, 3);
  assert.equal(data.events[0].lookbackDays, undefined);
  assert.equal(data.events[0].timeline.length, 2);
  assert.deepEqual(data.events[0].timeline.map((item) => item.date), ["2026-06-01", "2026-06-04"]);
  assert.deepEqual(data.events[0].evidenceItems.map((item) => item.id), ["ai-1", "ai-2"]);
});

test("buildEvents avoids broad category buckets for unrelated items", () => {
  const data = buildEvents([
    {
      id: "ai-chip",
      title: "AI chip export rule changes",
      summary: "Export controls affect chips.",
      source: "Source A",
      category: "tech",
      publishedAt: "2026-06-01T00:00:00.000Z",
      score: 94,
      article_keywords: ["AI芯片", "出口管制"]
    },
    {
      id: "ai-app",
      title: "Company launches consumer AI assistant",
      summary: "A new assistant reaches users.",
      source: "Source B",
      category: "tech",
      publishedAt: "2026-06-02T00:00:00.000Z",
      score: 92,
      article_keywords: ["AI应用", "消费电子"]
    }
  ], "2026-06-02T03:00:00.000Z");

  assert.equal(data.totalEvents, 0);
});
