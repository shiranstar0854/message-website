const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeRawItem,
  normalizeImageUrl,
  filterItems,
  dedupeItems,
  scoreItems,
  detectItemLanguage,
  inferRefinedTags,
  buildTopHotspots,
  buildLatestData
} = require("../scripts/lib/pipeline");
const { extractItems } = require("../scripts/lib/rss-parser");
const { limitNewestItems: limitNewestRssItems } = require("../scripts/fetch-rss");

test("limits RSS source items to fifteen newest records", () => {
  const items = Array.from({ length: 20 }, (_, index) => ({
    title: `Official item ${index}`,
    link: `https://example.test/rss/${index}`,
    pubDate: `2026-05-30T${String(index).padStart(2, "0")}:00:00.000Z`
  }));

  const limited = limitNewestRssItems(items, { maxItems: 30 }, "2026-05-30T20:00:00.000Z");

  assert.equal(limited.length, 15);
  assert.equal(limited[0].pubDate, "2026-05-30T19:00:00.000Z");
  assert.equal(limited.at(-1).pubDate, "2026-05-30T05:00:00.000Z");
});

test("RSS source limiting drops records older than forty eight hours", () => {
  const items = [
    { title: "Fresh official item", link: "https://example.test/fresh", pubDate: "2026-05-30T12:00:00.000Z" },
    { title: "Old official item", link: "https://example.test/old", pubDate: "2026-05-28T11:59:59.000Z" },
    { title: "Stale 2024 official item", link: "https://example.test/2024", pubDate: "2024-05-30T12:00:00.000Z" }
  ];

  const limited = limitNewestRssItems(items, {}, "2026-05-30T12:00:00.000Z");

  assert.deepEqual(limited.map((item) => item.title), ["Fresh official item"]);
});

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
    sourceAuthority: "official-agency",
    timelinessTier: "hourly",
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
  assert.equal(api.sourceAuthority, "official-agency");
  assert.equal(api.timelinessTier, "hourly");
  assert.equal(api.sourceLastCheckedAt, "2026-05-24T00:00:00.000Z");
  assert.equal(api.summary, "Policy makers held rates steady.");
});

test("extracts RSS content and media fields for display enrichment", () => {
  const items = extractItems(`
    <rss><channel><item>
      <title>Media story</title>
      <link>https://example.test/story</link>
      <description><![CDATA[Short <img src="https://example.test/fallback.jpg"> summary]]></description>
      <content:encoded><![CDATA[<p>Long story body</p>]]></content:encoded>
      <media:thumbnail url="https://example.test/thumb.jpg" />
    </item></channel></rss>
  `);

  assert.equal(items.length, 1);
  assert.equal(items[0].content, "<p>Long story body</p>");
  assert.equal(items[0].feedImageUrl, "https://example.test/thumb.jpg");
});

test("rejects non-web and malformed item urls", () => {
  const unsafe = normalizeRawItem({
    title: "Unsafe feed entry",
    link: "javascript:alert(document.domain)",
    source: "Untrusted feed",
    category: "news"
  }, "2026-05-24T00:00:00.000Z");
  const malformed = normalizeRawItem({
    title: "Malformed feed entry",
    link: "not a valid absolute url",
    source: "Untrusted feed",
    category: "news"
  }, "2026-05-24T00:00:00.000Z");

  assert.equal(unsafe.url, "");
  assert.equal(malformed.url, "");
  assert.deepEqual(filterItems([unsafe, malformed], { requireUrl: true }), []);
});

test("normalizes optional excerpts and only accepts https images", () => {
  const item = normalizeRawItem({
    sourceName: "Source A",
    sourceId: "source-a",
    category: "news",
    title: "Image item",
    link: "https://example.test/item",
    content: "<p>Detailed article text</p>",
    feedImageUrl: "http://example.test/image.jpg"
  }, "2026-05-24T00:00:00.000Z");
  const secureItem = normalizeRawItem({
    sourceName: "Source A",
    sourceId: "source-a",
    category: "news",
    title: "Secure image item",
    link: "https://example.test/item-2",
    feedImageUrl: "https://example.test/image.jpg"
  }, "2026-05-24T00:00:00.000Z");

  assert.equal(item.sourceId, "source-a");
  assert.equal(item.contentExcerpt, "Detailed article text");
  assert.equal(item.imageUrl, undefined);
  assert.equal(secureItem.imageUrl, "https://example.test/image.jpg");
  assert.equal(normalizeImageUrl("javascript:alert(1)"), "");
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

test("filters out items older than configured hard age window", () => {
  const rules = {
    allowedCategories: ["tech"],
    requireUrl: true,
    minimumTitleLength: 6,
    maxAgeHours: 48,
    nowIso: "2026-05-30T12:00:00.000Z"
  };

  const items = [
    { id: "fresh", title: "Fresh platform update", url: "https://a.test/fresh", source: "Trusted", category: "tech", summary: "", publishedAt: "2026-05-28T12:00:00.000Z" },
    { id: "old", title: "Old platform update", url: "https://a.test/old", source: "Trusted", category: "tech", summary: "", publishedAt: "2026-05-28T11:59:59.000Z" }
  ];

  const filtered = filterItems(items, rules);

  assert.deepEqual(filtered.map((item) => item.id), ["fresh"]);
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
      sourceAuthority: "official-agency",
      timelinessTier: "hourly",
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
      sourceAuthorityBoosts: { "official-agency": 5 },
      timelinessBoosts: { hourly: 3 },
      officialFreshnessWindowHours: 24,
      officialFreshnessBoost: 5,
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
  assert.equal(scored.find((item) => item.id === "ai").scoreBreakdown.authorityBoost, 5);
  assert.equal(scored.find((item) => item.id === "ai").scoreBreakdown.officialFreshnessBoost, 5);
  assert.equal(latest.channels.tech.items.length, 1);
  assert.equal(latest.channels.tech.items[0].id, "ai");
  assert.equal(latest.channels.finance.items[0].id, "market");
  assert.equal(latest.generatedAt, "2026-05-24T12:00:00.000Z");
});

test("latest data publishes compact display fields only", () => {
  const latest = buildLatestData([{
    id: "compact",
    title: "Compact website payload",
    url: "https://example.com/compact",
    source: "Example",
    sourceType: "rss",
    category: "tech",
    publishedAt: "2026-05-24T00:00:00.000Z",
    fetchedAt: "2026-05-24T01:00:00.000Z",
    sourceLastCheckedAt: "2026-05-24T01:00:00.000Z",
    sourceAuthority: "official-market",
    timelinessTier: "daily",
    summary: "x".repeat(900),
    contentExcerpt: "y".repeat(900),
    imageUrl: "https://example.com/image.jpg",
    tags: Array.from({ length: 10 }, (_, index) => `tag-${index}`),
    score: 88,
    duplicateCount: 2,
    raw: { content: "unpublished source payload" },
    scoreBreakdown: { freshness: 10 },
    filterReasons: []
  }], {
    channels: [{ id: "tech", label: "Technology" }]
  });

  assert.equal(latest.items[0].summary.length, 500);
  assert.equal(latest.items[0].contentExcerpt.length, 500);
  assert.equal(latest.items[0].imageUrl, "https://example.com/image.jpg");
  assert.equal(latest.items[0].fetchedAt, "2026-05-24T01:00:00.000Z");
  assert.equal(latest.items[0].sourceAuthority, "official-market");
  assert.equal(latest.items[0].tags.length, 8);
  assert.equal(latest.items[0].duplicateCount, 2);
  assert.equal("raw" in latest.items[0], false);
  assert.equal("scoreBreakdown" in latest.items[0], false);
  assert.equal("filterReasons" in latest.items[0], false);
});

test("latest data adds refined tags, impact areas, language, and hotspot ranking", () => {
  const latest = buildLatestData([
    {
      id: "ai-chip",
      title: "NVIDIA announces new AI chip platform for data centers",
      url: "https://example.com/ai-chip",
      source: "Official Tech",
      sourceType: "rss",
      category: "tech",
      publishedAt: "2026-06-03T00:00:00.000Z",
      fetchedAt: "2026-06-03T01:00:00.000Z",
      sourceAuthority: "official-agency",
      timelinessTier: "daily",
      summary: "The company described a GPU platform for AI workloads.",
      contentExcerpt: "The company described a GPU platform for AI workloads in data centers.",
      tags: [],
      score: 95,
      duplicateCount: 2
    },
    {
      id: "macro",
      title: "统计部门发布最新PMI数据",
      url: "https://example.com/pmi",
      source: "Official Macro",
      sourceType: "webpage",
      category: "finance",
      publishedAt: "2026-06-02T00:00:00.000Z",
      fetchedAt: "2026-06-03T01:00:00.000Z",
      sourceAuthority: "official-agency",
      timelinessTier: "daily",
      summary: "宏观数据反映采购经理指数变化。",
      tags: [],
      score: 88,
      duplicateCount: 0
    }
  ], {
    channels: [
      { id: "tech", label: "Technology" },
      { id: "finance", label: "Finance" }
    ]
  }, "2026-06-03T02:00:00.000Z");

  const aiItem = latest.items.find((item) => item.id === "ai-chip");
  const macroItem = latest.items.find((item) => item.id === "macro");

  assert.equal(detectItemLanguage(aiItem), "en");
  assert.equal(aiItem.language, "en");
  assert.ok(aiItem.refinedTags.includes("AI芯片"));
  assert.ok(aiItem.impactAreas.includes("科技"));
  assert.equal(aiItem.displayTitle, "NVIDIA announces new AI chip platform for data centers");
  assert.equal(aiItem.originalTitle, aiItem.title);
  assert.equal(macroItem.language, "zh");
  assert.ok(macroItem.refinedTags.includes("宏观数据"));
  assert.equal(latest.topHotspots.length, 2);
  assert.equal(latest.topHotspots[0].id, "ai-chip");
});

test("top hotspots keep compact public fields", () => {
  const hotspots = buildTopHotspots([{
    id: "hot",
    title: "Original title",
    displayTitle: "中文标题",
    displaySummary: "一句话解释",
    url: "https://example.test/hot",
    source: "Official",
    publishedAt: "2026-06-03T00:00:00.000Z",
    sourceAuthority: "official-agency",
    score: 90,
    refinedTags: ["AI模型"],
    impactAreas: ["科技"],
    hotspotScore: 120,
    raw: { ignored: true }
  }], "2026-06-03T01:00:00.000Z");

  assert.deepEqual(Object.keys(hotspots[0]), [
    "id",
    "title",
    "displayTitle",
    "displaySummary",
    "importance",
    "impactAreas",
    "source",
    "publishedAt",
    "score",
    "url"
  ]);
  assert.equal(hotspots[0].displayTitle, "中文标题");
  assert.equal(hotspots[0].importance, 120);
});
