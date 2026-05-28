const test = require("node:test");
const assert = require("node:assert/strict");

const { summarizeLatestData } = require("../scripts/generate-ai-summary");
const { buildWeeklyReview, isoWeekId } = require("../scripts/generate-weekly-review");

test("daily summary generation adds compact summary fields to top channel items", () => {
  const latest = {
    generatedAt: "2026-05-28T00:00:00.000Z",
    channels: {
      tech: { id: "tech", items: [{ id: "tech-1" }] }
    },
    items: [{
      id: "tech-1",
      title: "Platform update",
      url: "https://example.test/tech",
      source: "Official Source",
      category: "tech",
      score: 91,
      contentExcerpt: "This platform update changes the developer workflow. It includes safety controls."
    }]
  };

  const summarized = summarizeLatestData(latest, {
    method: "extractive",
    daily: { maxItemsPerChannel: 1, minimumScore: 60, summaryMaxLength: 80 }
  }, "2026-05-28T01:00:00.000Z");

  assert.equal(summarized.items[0].summaryMethod, "extractive");
  assert.match(summarized.items[0].aiSummary, /developer workflow/);
  assert.equal(summarized.channels.tech.items[0].aiSummary, summarized.items[0].aiSummary);
});

test("weekly review builds channel highlights from daily archives", () => {
  const review = buildWeeklyReview([{
    date: "2026-05-28",
    items: [
      {
        id: "finance-1",
        title: "Central bank update",
        url: "https://example.test/finance",
        source: "Federal Reserve",
        category: "finance",
        score: 95,
        aiSummary: "Policy makers published a financial stability update.",
        publishedAt: "2026-05-28T00:00:00.000Z"
      },
      {
        id: "news-1",
        title: "UN briefing",
        url: "https://example.test/news",
        source: "UN News",
        category: "news",
        score: 88,
        contentExcerpt: "The briefing highlighted a global policy issue.",
        publishedAt: "2026-05-28T00:00:00.000Z"
      }
    ]
  }], {
    weekly: { maxHighlightsPerChannel: 4, maxSourcesPerChannel: 3 }
  }, "2026-05-28T02:00:00.000Z");

  assert.equal(review.weekId, isoWeekId(new Date("2026-05-28T02:00:00.000Z")));
  assert.equal(review.totals.archiveCount, 1);
  assert.equal(review.channels.find((channel) => channel.id === "finance").highlights[0].source, "Federal Reserve");
  assert.equal(review.channels.find((channel) => channel.id === "news").highlights[0].summary, "The briefing highlighted a global policy issue.");
});
