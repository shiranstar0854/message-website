const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeRawItem,
  filterItems,
  dedupeItems,
  scoreItems,
  buildLatestData
} = require("../scripts/lib/pipeline");

test("normalizes rss and api records into the shared item shape", () => {
  const rss = normalizeRawItem({
    sourceName: "TechCrunch",
    sourceType: "rss",
    category: "tech",
    credibility: 83,
    title: "OpenAI launches a new developer platform",
    link: "https://example.com/openai-platform?utm_source=rss",
    pubDate: "2026-05-23T08:00:00.000Z",
    contentSnippet: "Developers get a new workflow."
  }, "2026-05-24T00:00:00.000Z");

  const api = normalizeRawItem({
    sourceName: "Federal Reserve",
    sourceType: "api",
    category: "finance",
    credibility: 95,
    headline: "Rate decision released",
    url: "https://example.com/rates",
    published_at: "2026-05-22T12:30:00.000Z",
    summary: "Policy makers held rates steady."
  }, "2026-05-24T00:00:00.000Z");

  assert.equal(rss.title, "OpenAI launches a new developer platform");
  assert.equal(rss.url, "https://example.com/openai-platform");
  assert.equal(rss.category, "tech");
  assert.equal(rss.fetchedAt, "2026-05-24T00:00:00.000Z");
  assert.ok(rss.id.startsWith("tech-techcrunch-"));

  assert.equal(api.title, "Rate decision released");
  assert.equal(api.sourceType, "api");
  assert.equal(api.summary, "Policy makers held rates steady.");
});

test("filters items by category, blocked source, low-value phrases, and minimum title length", () => {
  const rules = {
    allowedCategories: ["tech", "finance", "news"],
    blockedSources: ["Blocked Source"],
    blockedTerms: ["celebrity gossip"],
    lowValueTitlePatterns: ["sponsored", "coupon"],
    minimumTitleLength: 12,
    requireUrl: true
  };

  const items = [
    { id: "1", title: "AI market structure shifts", url: "https://a.test/1", source: "Trusted", category: "tech", summary: "" },
    { id: "2", title: "Coupon roundup", url: "https://a.test/2", source: "Trusted", category: "tech", summary: "" },
    { id: "3", title: "Celebrity gossip update", url: "https://a.test/3", source: "Trusted", category: "news", summary: "" },
    { id: "4", title: "Valid but blocked source item", url: "https://a.test/4", source: "Blocked Source", category: "finance", summary: "" },
    { id: "5", title: "Short", url: "https://a.test/5", source: "Trusted", category: "tech", summary: "" },
    { id: "6", title: "Valid title missing category", url: "https://a.test/6", source: "Trusted", category: "sports", summary: "" }
  ];

  const filtered = filterItems(items, rules);

  assert.deepEqual(filtered.map((item) => item.id), ["1"]);
  assert.deepEqual(filtered[0].filterReasons, []);
});

test("dedupes identical urls and highly similar titles while preserving duplicate metadata", () => {
  const items = [
    {
      id: "a",
      title: "OpenAI releases new model for developers",
      url: "https://example.com/openai-model",
      source: "Source A",
      category: "tech",
      publishedAt: "2026-05-24T09:00:00.000Z",
      credibility: 80
    },
    {
      id: "b",
      title: "OpenAI releases a new model for developers",
      url: "https://example.com/openai-model?ref=homepage",
      source: "Source B",
      category: "tech",
      publishedAt: "2026-05-24T10:00:00.000Z",
      credibility: 90
    },
    {
      id: "c",
      title: "Central bank publishes stability report",
      url: "https://example.com/stability",
      source: "Source C",
      category: "finance",
      publishedAt: "2026-05-23T10:00:00.000Z",
      credibility: 75
    }
  ];

  const deduped = dedupeItems(items, { titleSimilarityThreshold: 0.82 });

  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].id, "b");
  assert.deepEqual(deduped[0].duplicates.map((item) => item.id), ["a"]);
  assert.equal(deduped[1].id, "c");
});

test("scores items and builds channel-limited latest data sorted by score", () => {
  const items = [
    {
      id: "ai",
      title: "AI regulation changes cloud infrastructure strategy",
      url: "https://example.com/ai",
      source: "Official Tech",
      category: "tech",
      summary: "AI regulation has infrastructure impact.",
      publishedAt: "2026-05-24T00:00:00.000Z",
      credibility: 90,
      duplicates: [{ id: "dup" }]
    },
    {
      id: "market",
      title: "Regional market commentary",
      url: "https://example.com/market",
      source: "Market Desk",
      category: "finance",
      summary: "Markets were mixed.",
      publishedAt: "2026-05-18T00:00:00.000Z",
      credibility: 70,
      duplicates: []
    },
    {
      id: "news",
      title: "Election officials publish final timeline",
      url: "https://example.com/news",
      source: "News Wire",
      category: "news",
      summary: "Timeline released.",
      publishedAt: "2026-05-23T12:00:00.000Z",
      credibility: 82,
      duplicates: []
    }
  ];

  const scored = scoreItems(items, {
    baseScore: 40,
    sourceCredibilityWeight: 0.3,
    freshness: { halfLifeHours: 72, weight: 20 },
    duplicatePenalty: 2,
    keywordWeights: {
      highValue: [
        { term: "AI", score: 12 },
        { term: "regulation", score: 8 },
        { term: "election", score: 5 }
      ]
    }
  }, "2026-05-24T12:00:00.000Z");

  const latest = buildLatestData(scored, {
    siteName: "Message Choose",
    defaultLimit: 1,
    channels: [
      { id: "tech", label: "Technology" },
      { id: "finance", label: "Finance" },
      { id: "news", label: "News" }
    ]
  }, "2026-05-24T12:00:00.000Z");

  assert.ok(scored.find((item) => item.id === "ai").score > scored.find((item) => item.id === "market").score);
  assert.equal(latest.channels.tech.items.length, 1);
  assert.equal(latest.channels.tech.items[0].id, "ai");
  assert.equal(latest.channels.finance.items[0].id, "market");
  assert.equal(latest.generatedAt, "2026-05-24T12:00:00.000Z");
});
