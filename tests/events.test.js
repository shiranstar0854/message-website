const test = require("node:test");
const assert = require("node:assert/strict");

const { buildEvents } = require("../scripts/generate-events");

test("buildEvents groups related high-value items into event clusters", () => {
  const data = buildEvents([
    {
      id: "ai-1",
      title: "AI regulation update",
      summary: "New AI safety framework.",
      title_zh: "AI 监管更新",
      summary_zh: "新的 AI 安全框架发布。",
      translation_status: "translated",
      sourceLanguage: "en",
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
      title_zh: "人工智能政策听证会",
      summary_zh: "立法者讨论模型治理。",
      translation_status: "translated",
      sourceLanguage: "en",
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
  assert.equal(data.events[0].latestUpdate.title, "人工智能政策听证会");
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

test("buildEvents excludes untranslated non-Chinese items from event tracking", () => {
  const data = buildEvents([
    {
      id: "en-untranslated-1",
      title: "Central bank policy update",
      summary: "The central bank published rate guidance.",
      source: "Source A",
      sourceLanguage: "en",
      category: "macro",
      publishedAt: "2026-06-01T00:00:00.000Z",
      score: 92,
      article_keywords: ["央行"]
    },
    {
      id: "en-untranslated-2",
      title: "Central bank liquidity update",
      summary: "The bank discussed market liquidity.",
      source: "Source B",
      sourceLanguage: "en",
      category: "macro",
      publishedAt: "2026-06-02T00:00:00.000Z",
      score: 90,
      article_keywords: ["央行"]
    }
  ], "2026-06-02T03:00:00.000Z");

  assert.equal(data.totalEvents, 0);
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

test("buildEvents marks US equity events with market context and decision brief", () => {
  const data = buildEvents([
    {
      id: "nvda-sec",
      title: "SEC disclosure highlights NVIDIA AI chip demand",
      summary: "NVIDIA supplier disclosure points to AI accelerator demand.",
      title_zh: "SEC 披露显示 NVIDIA AI 芯片需求变化",
      summary_zh: "NVIDIA 供应链披露指向 AI 加速器需求变化。",
      translation_status: "translated",
      sourceLanguage: "en",
      source: "U.S. SEC Press Releases",
      sourceAuthority: "official-agency",
      category: "finance",
      publishedAt: "2026-06-01T00:00:00.000Z",
      score: 92,
      keywords: ["NVDA", "AI"]
    },
    {
      id: "nvda-market",
      title: "NVIDIA shares move after AI chip update",
      summary: "NVDA and SMH moved after the chip update.",
      title_zh: "NVIDIA 股价在 AI 芯片更新后波动",
      summary_zh: "NVDA 和 SMH 在芯片更新后出现波动。",
      translation_status: "translated",
      sourceLanguage: "en",
      source: "Market Desk",
      sourceAuthority: "financial-media",
      category: "finance",
      publishedAt: "2026-06-02T00:00:00.000Z",
      score: 88,
      keywords: ["NVDA", "SMH", "AI"]
    }
  ], "2026-06-02T03:00:00.000Z", {
    marketContext: {
      status: "available",
      generatedAt: "2026-06-02T02:00:00.000Z",
      symbols: {
        NVDA: { symbol: "NVDA", status: "available", price: 125, changePercent: "2.5%" }
      },
      topMovers: []
    }
  });

  assert.equal(data.totalEvents, 1);
  assert.equal(data.events[0].decisionLane, "us_equities");
  assert.equal(data.events[0].decisionGrade, "A");
  assert.equal(data.events[0].decisionSignal, "优先跟踪");
  assert.ok(data.events[0].decisionBrief);
  assert.deepEqual(data.events[0].marketContext.tickers.includes("NVDA"), true);
});

test("buildEvents does not promote generic market stories without tickers", () => {
  const data = buildEvents([
    {
      id: "market-1",
      title: "US stock market changes after broad risk reset",
      summary: "Investors discuss general market direction.",
      title_zh: "美股市场在风险重估后变化",
      summary_zh: "投资者讨论整体市场方向。",
      translation_status: "translated",
      sourceLanguage: "en",
      source: "Market Desk A",
      category: "finance",
      publishedAt: "2026-06-01T00:00:00.000Z",
      score: 86,
      keywords: ["market"]
    },
    {
      id: "market-2",
      title: "Wall Street sees another broad market change",
      summary: "Traders track indexes without a named ticker.",
      title_zh: "华尔街出现另一轮广泛市场变化",
      summary_zh: "交易员跟踪指数，但没有具体标的。",
      translation_status: "translated",
      sourceLanguage: "en",
      source: "Market Desk B",
      category: "finance",
      publishedAt: "2026-06-02T00:00:00.000Z",
      score: 84,
      keywords: ["market"]
    }
  ], "2026-06-02T03:00:00.000Z", {
    marketContext: { status: "available", symbols: {}, topMovers: [] }
  });

  assert.equal(data.totalEvents, 0);
});

test("buildEvents only promotes China policy events from authoritative sources", () => {
  const policyItems = [
    {
      id: "policy-1",
      title: "国务院发布人工智能政策落地安排",
      summary: "政策明确试点和执行节奏。",
      source: "中国政府网要闻",
      sourceAuthority: "official-agency",
      category: "news",
      publishedAt: "2026-06-01T00:00:00.000Z",
      score: 94,
      keywords: ["政策", "人工智能"]
    },
    {
      id: "policy-2",
      title: "科技部发布人工智能试点执行细则",
      summary: "试点将进入落地执行阶段。",
      source: "科技部工作动态",
      sourceAuthority: "official-agency",
      category: "tech",
      publishedAt: "2026-06-02T00:00:00.000Z",
      score: 92,
      keywords: ["政策", "人工智能"]
    }
  ];
  const promoted = buildEvents(policyItems, "2026-06-02T03:00:00.000Z");
  assert.equal(promoted.totalEvents, 1);
  assert.equal(promoted.events[0].decisionLane, "china_policy");
  assert.ok(promoted.events[0].policyStatus);

  const mediaOnly = buildEvents(policyItems.map((item) => ({
    ...item,
    source: "普通媒体",
    sourceAuthority: "media"
  })), "2026-06-02T03:00:00.000Z");
  assert.equal(mediaOnly.totalEvents, 0);
});

test("buildEvents marks China-US AI events as decision briefs", () => {
  const data = buildEvents([
    {
      id: "ai-us",
      title: "OpenAI releases enterprise AI model update",
      summary: "OpenAI describes new model capabilities for businesses.",
      title_zh: "OpenAI 发布企业 AI 模型更新",
      summary_zh: "OpenAI 说明面向企业的新模型能力。",
      translation_status: "translated",
      sourceLanguage: "en",
      source: "OpenAI News",
      sourceAuthority: "official-media",
      category: "tech",
      publishedAt: "2026-06-01T00:00:00.000Z",
      score: 91,
      keywords: ["AI development", "OpenAI"]
    },
    {
      id: "ai-cn",
      title: "Chinese AI lab expands large model compute",
      summary: "The update links Chinese AI development with model infrastructure.",
      title_zh: "中国 AI 实验室扩大大模型算力",
      summary_zh: "更新显示中国 AI 发展与模型基础设施相关。",
      translation_status: "translated",
      sourceLanguage: "en",
      source: "AI Industry Desk",
      sourceAuthority: "media",
      category: "tech",
      publishedAt: "2026-06-02T00:00:00.000Z",
      score: 93,
      keywords: ["AI development", "人工智能", "算力"]
    }
  ], "2026-06-02T03:00:00.000Z");

  assert.equal(data.totalEvents, 1);
  assert.equal(data.events[0].decisionLane, "china_us_ai");
  assert.ok(data.events[0].decisionBrief);
  assert.ok(data.events[0].confirmedFacts.length > 0);
});
