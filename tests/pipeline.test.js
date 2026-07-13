const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeRawItem,
  normalizeImageUrl,
  filterItems,
  dedupeItems,
  scoreItems,
  buildLatestData
} = require("../scripts/lib/pipeline");
const { buildLatestDataSafely } = require("../scripts/generate-latest-data");
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
  assert.equal(api.sourceTier, "S");
  assert.equal(api.evidence_type, "regulatory_document");
  assert.equal(api.evidence_weight, 95);
  assert.equal(api.timelinessTier, "hourly");
  assert.equal(api.sourceLastCheckedAt, "2026-05-24T00:00:00.000Z");
  assert.equal(api.summary, "Policy makers held rates steady.");
});

test("classifies source tiers and evidence types during normalization", () => {
  const report = normalizeRawItem({
    sourceName: "Reuters",
    sourceType: "rss",
    category: "business",
    title: "NVIDIA quarterly earnings report shows data center revenue growth",
    link: "https://example.test/nvidia",
    pubDate: "2026-05-24T00:00:00.000Z",
    summary: "The report includes financial data and market reaction."
  }, "2026-05-24T01:00:00.000Z");
  const social = normalizeRawItem({
    sourceName: "Personal Blog",
    sourceType: "blog",
    category: "tech",
    title: "My opinion on AI policy",
    link: "https://example.test/blog",
    summary: "Opinion only."
  }, "2026-05-24T01:00:00.000Z");

  assert.equal(report.sourceTier, "A");
  assert.equal(report.evidence_type, "financial_report");
  assert.equal(report.evidence_weight, 95);
  assert.equal(social.sourceTier, "C");
  assert.equal(social.publishedAtInferred, true);
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

test("derives expanded categories and language metadata from item text", () => {
  const macro = normalizeRawItem({
    sourceName: "Federal Reserve",
    sourceType: "rss",
    category: "finance",
    credibility: 95,
    title: "Federal Reserve rate decision highlights inflation risks",
    link: "https://example.test/fed",
    summary: "Central bank policy update."
  }, "2026-05-24T00:00:00.000Z");
  const business = normalizeRawItem({
    sourceName: "Business Source",
    sourceType: "rss",
    category: "news",
    title: "上市公司发布财报并披露利润增长",
    link: "https://example.test/business",
    summary: "公司营收和利润变化。"
  }, "2026-05-24T00:00:00.000Z");

  assert.equal(macro.category, "macro");
  assert.equal(macro.primaryCategory, "finance");
  assert.equal(macro.sourceLanguage, "en");
  assert.ok(macro.impactAreas.includes("宏观"));
  assert.equal(business.category, "business");
  assert.equal(business.primaryCategory, "news");
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

test("filters D-tier and optionally inferred publication dates", () => {
  const filtered = filterItems([
    {
      id: "marketing",
      title: "AI sponsored promotion with no evidence",
      url: "https://example.test/marketing",
      source: "Marketing Aggregator",
      sourceTier: "D",
      category: "tech",
      summary: "Sponsored content."
    },
    {
      id: "inferred-date",
      title: "AI policy update from a real source",
      url: "https://example.test/policy",
      source: "Official Source",
      sourceTier: "S",
      category: "tech",
      summary: "Policy released.",
      publishedAt: "2026-05-24T01:00:00.000Z",
      publishedAtInferred: true
    },
    {
      id: "valid",
      title: "AI policy update with official date",
      url: "https://example.test/valid",
      source: "Official Source",
      sourceTier: "S",
      category: "tech",
      summary: "Policy released.",
      publishedAt: "2026-05-24T00:00:00.000Z"
    }
  ], {
    allowedCategories: ["tech"],
    requireUrl: true,
    minimumTitleLength: 6,
    blockedSourceTiers: ["D"],
    requirePublishedAt: true
  });

  assert.deepEqual(filtered.map((item) => item.id), ["valid"]);
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
      impactAreas: ["AI政策", "监管"],
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
  assert.equal(scored.find((item) => item.id === "ai").sourceTier, "S");
  assert.equal(scored.find((item) => item.id === "ai").evidence_type, "regulatory_document");
  assert.ok(scored.find((item) => item.id === "ai").event_relevance_score >= 45);
  assert.equal(latest.channels.tech.items.length, 1);
  assert.equal(latest.channels.tech.items[0].id, "ai");
  assert.equal(latest.channels.finance.items[0].id, "market");
  assert.equal(latest.generatedAt, "2026-05-24T12:00:00.000Z");
});

test("scores C-tier opinion sources below evidence-backed reports", () => {
  const scored = scoreItems([
    {
      id: "opinion",
      title: "Opinion about OpenAI policy",
      url: "https://example.test/opinion",
      source: "Personal Blog",
      sourceType: "blog",
      sourceTier: "C",
      sourceAuthority: "blog",
      category: "tech",
      summary: "Opinion without confirmed facts.",
      publishedAt: "2026-05-24T00:00:00.000Z",
      credibility: 70
    },
    {
      id: "official",
      title: "OpenAI policy announcement includes developer safety requirements",
      url: "https://example.test/official",
      source: "Official Agency",
      sourceAuthority: "official-agency",
      sourceTier: "S",
      category: "tech",
      summary: "The agency announced requirements and provided supporting data.",
      publishedAt: "2026-05-24T00:00:00.000Z",
      credibility: 90,
      impactAreas: ["AI政策", "监管"]
    }
  ], {
    baseScore: 40,
    sourceCredibilityWeight: 0.3,
    freshness: { halfLifeHours: 72, weight: 20 },
    keywordWeights: { highValue: [{ term: "OpenAI", score: 8 }, { term: "policy", score: 6 }] }
  }, "2026-05-24T01:00:00.000Z");

  assert.ok(scored.find((item) => item.id === "official").score > scored.find((item) => item.id === "opinion").score);
  assert.equal(scored.find((item) => item.id === "opinion").scoreBreakdown.sourceTierBoost, -18);
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
    sourceTier: "S",
    timelinessTier: "daily",
    evidence_type: "financial_report",
    evidence_weight: 95,
    event_relevance_score: 82,
    summary: "x".repeat(900),
    contentExcerpt: "y".repeat(900),
    titleZh: "中文标题",
    summaryZh: "中文摘要",
    translatedTitle: "紧凑网站负载",
    aiSummary: "中文摘要解释 AI policy and market structure.",
    summaryReason: "Official Source / tech",
    importance: "高分官方市场来源，涉及 AI 政策。",
    what_happened: "官方市场来源披露 AI 政策相关信息。",
    confirmed_facts: ["来源为官方市场", "内容涉及 AI 政策"],
    what_changed: "信息为后续政策判断提供新材料。",
    impact_analysis: {
      market: "可能影响市场预期。",
      industry: "可能影响 AI 政策相关行业。",
      company: "目前证据不足",
      user: "目前证据不足"
    },
    uncertainties: ["后续执行细节仍需确认"],
    watch_variables: ["监管文本", "企业回应"],
    tracking_decision: "值得追踪",
    confidence_level: "中",
    source_links: [{ title: "原文", url: "https://example.com/compact" }],
    impactAreas: ["AI政策", "市场监管"],
    sourceLanguage: "en",
    summaryLanguage: "zh",
    imageUrl: "https://example.com/image.jpg",
    tags: Array.from({ length: 10 }, (_, index) => `tag-${index}`),
    keywordHits: [{ term: "AI", score: 8 }, { term: "market structure", score: 7 }],
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
  assert.equal(latest.items[0].titleZh, "中文标题");
  assert.equal(latest.items[0].title_zh, "中文标题");
  assert.equal(latest.items[0].title_original, "Compact website payload");
  assert.equal(latest.items[0].summaryZh, "中文摘要");
  assert.equal(latest.items[0].summary_zh, "中文摘要");
  assert.equal(latest.items[0].summary_original.length, 500);
  assert.equal(latest.items[0].aiSummary, "中文摘要解释 AI policy and market structure.");
  assert.equal(latest.items[0].summaryReason, "Official Source / tech");
  assert.equal(latest.items[0].translatedTitle, "紧凑网站负载");
  assert.equal(latest.items[0].importance, "高分官方市场来源，涉及 AI 政策。");
  assert.equal(latest.items[0].what_happened, "官方市场来源披露 AI 政策相关信息。");
  assert.deepEqual(latest.items[0].confirmed_facts, ["来源为官方市场", "内容涉及 AI 政策"]);
  assert.equal(latest.items[0].what_changed, "信息为后续政策判断提供新材料。");
  assert.equal(latest.items[0].impact_analysis.market, "可能影响市场预期。");
  assert.deepEqual(latest.items[0].uncertainties, ["后续执行细节仍需确认"]);
  assert.deepEqual(latest.items[0].watch_variables, ["监管文本", "企业回应"]);
  assert.equal(latest.items[0].tracking_decision, "值得追踪");
  assert.equal(latest.items[0].confidence_level, "中");
  assert.equal(latest.items[0].source_links[0].url, "https://example.com/compact");
  assert.deepEqual(latest.items[0].impactAreas, ["AI政策", "市场监管"]);
  assert.equal(latest.items[0].sourceLanguage, "en");
  assert.equal(latest.items[0].source_language, "en");
  assert.equal(latest.items[0].translation_status, "translated");
  assert.equal(latest.items[0].summaryLanguage, "zh");
  assert.equal(latest.items[0].imageUrl, "https://example.com/image.jpg");
  assert.equal(latest.items[0].fetchedAt, "2026-05-24T01:00:00.000Z");
  assert.equal(latest.items[0].sourceAuthority, "official-market");
  assert.equal(latest.items[0].sourceTier, "S");
  assert.equal(latest.items[0].evidence_type, "financial_report");
  assert.equal(latest.items[0].evidence_weight, 95);
  assert.equal(latest.items[0].event_relevance_score, 82);
  assert.equal(latest.items[0].tags.length, 8);
  assert.ok(latest.items[0].article_keywords.includes("AI"));
  assert.ok(latest.items[0].article_keywords.includes("market structure"));
  assert.ok(latest.items[0].keywords.includes("AI"));
  assert.equal(latest.items[0].duplicateCount, 2);
  assert.equal("raw" in latest.items[0], false);
  assert.equal("scoreBreakdown" in latest.items[0], false);
  assert.equal("filterReasons" in latest.items[0], false);
});

test("canonical categories keep the existing six-channel UI grouping", () => {
  const latest = buildLatestData([
    { id: "tech", title: "Model release", url: "https://example.test/tech", source: "A", category: "technology", sourceCategory: "tech", publishedAt: "2026-05-24T00:00:00.000Z", score: 90 },
    { id: "macro", title: "Inflation data", url: "https://example.test/macro", source: "B", category: "macro", sourceCategory: "finance", publishedAt: "2026-05-24T00:00:00.000Z", score: 88 },
    { id: "policy", title: "Regulation update", url: "https://example.test/policy", source: "C", category: "policy", sourceCategory: "news", publishedAt: "2026-05-24T00:00:00.000Z", score: 86 }
  ], {
    channels: [
      { id: "tech", label: "科技" }, { id: "finance", label: "金融" },
      { id: "business", label: "商业" }, { id: "macro", label: "宏观" },
      { id: "international", label: "国际" }, { id: "news", label: "新闻" }
    ]
  });

  assert.equal(latest.channels.tech.items[0].category, "technology");
  assert.equal(latest.channels.macro.items[0].category, "macro");
  assert.equal(latest.channels.news.items[0].category, "policy");
  assert.equal(latest.items[0].displayChannel, "tech");
});

test("empty current output preserves the previous public feed", () => {
  const previous = { generatedAt: "2026-07-11T00:00:00.000Z", totalItems: 1, items: [{ id: "previous" }], channels: {} };
  const latest = buildLatestDataSafely([], { channels: [] }, previous, "2026-07-12T00:00:00.000Z");
  assert.equal(latest.items[0].id, "previous");
  assert.equal(latest.preservation.reason, "empty-current-pipeline-output");
  assert.equal(latest.generatedAt, previous.generatedAt);
});
