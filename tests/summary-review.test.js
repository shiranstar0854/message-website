const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDeepSeekRequestBody,
  buildDailyChannelSummaries,
  buildDailySummaryOutput,
  buildItemSummaryRules,
  detectItemLanguage,
  isLlmConfigured,
  selectSummaryIds,
  summarizeLatestData,
  summarizeLatestDataWithLlm
} = require("../scripts/generate-ai-summary");
const {
  buildWeeklyReview,
  enhanceWeeklyReviewWithLlm,
  filterEnabledSourceItems,
  isoWeekId
} = require("../scripts/generate-weekly-review");

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

test("daily summary LLM path keeps existing data when the required secret is missing", async () => {
  const latest = {
    generatedAt: "2026-05-28T00:00:00.000Z",
    channels: {
      finance: { id: "finance", items: [{ id: "finance-1" }] }
    },
    items: [{
      id: "finance-1",
      title: "Market update",
      url: "https://example.test/finance",
      source: "Official Source",
      category: "finance",
      score: 91,
      contentExcerpt: "A public market update explained liquidity and policy expectations."
    }]
  };
  const rules = {
    method: "extractive",
    llmProduction: {
      enabled: true,
      provider: "deepseek-chat-completions",
      model: "deepseek-v4-flash",
      requiredSecret: "DEEPSEEK_API_KEY"
    },
    daily: { maxItemsPerChannel: 1, minimumScore: 60, summaryMaxLength: 80 }
  };

  const summarized = await summarizeLatestDataWithLlm(latest, rules, "2026-05-28T01:00:00.000Z", {
    env: {}
  });

  assert.equal(isLlmConfigured(rules, {}), false);
  assert.equal(summarized.items[0].summaryMethod, undefined);
  assert.equal(summarized.items[0].aiSummary, undefined);
  assert.equal(summarized.summaryStats.llmConfigured, false);
  assert.equal(summarized.summaryStats.llmAttempted, 0);
  assert.equal(summarized.summaryStats.fallbackCount, 0);
});

test("article AI summaries use DEEPSEEK_API_KEY1 while daily briefs keep DEEPSEEK_API_KEY", () => {
  const rules = {
    llmProduction: {
      enabled: true,
      requiredSecret: "DEEPSEEK_API_KEY",
      itemRequiredSecret: "DEEPSEEK_API_KEY1"
    }
  };

  assert.equal(rules.llmProduction.requiredSecret, "DEEPSEEK_API_KEY");
  assert.equal(buildItemSummaryRules(rules).llmProduction.requiredSecret, "DEEPSEEK_API_KEY1");
});

test("daily summary LLM path translates selected item summaries to Chinese", async () => {
  const latest = {
    generatedAt: "2026-05-28T00:00:00.000Z",
    channels: {
      tech: { id: "tech", items: [{ id: "tech-1" }] }
    },
    items: [{
      id: "tech-1",
      title: "Codex becomes a productivity tool",
      url: "https://example.test/tech",
      source: "OpenAI News",
      category: "tech",
      score: 91,
      contentExcerpt: "Codex helps knowledge workers with research, data analysis, and workflow automation."
    }]
  };
  const rules = {
    method: "extractive",
    llmProduction: {
      enabled: true,
      provider: "deepseek-chat-completions",
      endpoint: "https://api.deepseek.com/chat/completions",
      model: "deepseek-v4-flash",
      requiredSecret: "DEEPSEEK_API_KEY",
      maxRetries: 0,
      maxOutputTokens: 260
    },
    daily: { maxItemsPerChannel: 1, minimumScore: 60, summaryMaxLength: 80, reasonMaxLength: 60 }
  };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              translatedTitle: "Codex 成为知识工作的生产力工具",
              aiSummary: "Codex 正在成为面向知识工作的生产力工具。",
              summaryReason: "高分科技来源，涉及工作流自动化。",
              importance: "影响知识工作者的 AI 工具使用方式。",
              impactAreas: ["AI政策", "开发者工具"]
            })
          }
        }]
      })
    };
  };

  const summarized = await summarizeLatestDataWithLlm(latest, rules, "2026-05-28T01:00:00.000Z", {
    env: { DEEPSEEK_API_KEY1: "test-key" },
    fetchImpl
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
  assert.equal(summarized.summaryStats.llmAttempted, 1);
  assert.equal(summarized.summaryStats.llmSucceeded, 1);
  assert.equal(summarized.items[0].summaryMethod, "deepseek-chat-completions");
  assert.equal(summarized.items[0].sourceLanguage, "en");
  assert.equal(summarized.items[0].summaryLanguage, "zh");
  assert.equal(summarized.items[0].translatedTitle, "Codex 成为知识工作的生产力工具");
  assert.equal(summarized.items[0].importance, "影响知识工作者的 AI 工具使用方式。");
  assert.deepEqual(summarized.items[0].impactAreas, ["AI政策", "开发者工具"]);
  assert.match(summarized.items[0].aiSummary, /生产力工具/);
  assert.ok(summarized.items[0].keywords.includes("Codex"));
});

test("English source items are selected for AI Chinese translation even below normal score floor", () => {
  const latest = {
    items: [{
      id: "english-low-score",
      title: "UN briefing outlines climate response",
      url: "https://example.test/un",
      source: "UN News",
      category: "news",
      score: 45,
      contentExcerpt: "The briefing outlined a coordinated climate response with funding, public health support, and local adaptation measures."
    }, {
      id: "chinese-low-score",
      title: "本地政策简讯",
      url: "https://example.test/cn",
      source: "中文来源",
      category: "news",
      score: 45,
      contentExcerpt: "本地政策简讯介绍后续执行安排。"
    }]
  };

  const selected = selectSummaryIds(latest, {
    maxItemsPerChannel: 1,
    minimumScore: 60,
    maxEnglishTranslationItems: 5
  });

  assert.equal(detectItemLanguage(latest.items[0]), "en");
  assert.equal(selected.has("english-low-score"), true);
  assert.equal(selected.has("chinese-low-score"), false);
});

test("daily summary LLM path covers non-default categories and overwrites old summaries", async () => {
  const latest = {
    generatedAt: "2026-05-28T00:00:00.000Z",
    channels: {
      macro: { id: "macro", items: [{ id: "macro-1" }] }
    },
    items: [{
      id: "macro-1",
      title: "Central bank policy update",
      url: "https://example.test/macro",
      source: "Official Source",
      category: "macro",
      score: 91,
      summary_short: "Old extractive summary",
      ai_model: "extractive",
      contentExcerpt: "The central bank published a policy update with rate guidance and market liquidity notes."
    }]
  };
  const calls = [];
  const summarized = await summarizeLatestDataWithLlm(latest, {
    llmProduction: {
      enabled: true,
      provider: "deepseek-chat-completions",
      endpoint: "https://api.deepseek.com/chat/completions",
      model: "deepseek-v4-flash",
      requiredSecret: "DEEPSEEK_API_KEY"
    },
    daily: { minimumScore: 60 }
  }, "2026-05-28T01:00:00.000Z", {
    env: { DEEPSEEK_API_KEY1: "test-key" },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                summary_short: "Policy guidance changed market liquidity expectations.",
                summary_points: ["The central bank published policy guidance.", "The update mentioned market liquidity."],
                key_data: [],
                why_it_matters: "It affects how investors read policy and liquidity signals.",
                impact: "Market participants may adjust rate and liquidity expectations.",
                risks: "The source does not provide enough detail to judge follow-up actions.",
                neutrality_check: "Only source-provided facts are used.",
                confidence: "medium"
              })
            }
          }]
        })
      };
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(summarized.items[0].category, "macro");
  assert.equal(summarized.items[0].ai_model, "deepseek-v4-flash");
  assert.equal(summarized.items[0].summary_short, "Policy guidance changed market liquidity expectations.");
  assert.equal(summarized.channels.macro.items[0].summary_short, summarized.items[0].summary_short);
});

test("daily summary LLM path preserves old summary when a model call fails", async () => {
  const latest = {
    generatedAt: "2026-05-28T00:00:00.000Z",
    channels: {
      macro: { id: "macro", items: [{ id: "macro-1" }] }
    },
    items: [{
      id: "macro-1",
      title: "Central bank policy update",
      url: "https://example.test/macro",
      source: "Official Source",
      category: "macro",
      score: 91,
      summary_short: "Existing LLM summary",
      ai_model: "deepseek-v4-flash"
    }]
  };
  const summarized = await summarizeLatestDataWithLlm(latest, {
    llmProduction: {
      enabled: true,
      provider: "deepseek-chat-completions",
      endpoint: "https://api.deepseek.com/chat/completions",
      model: "deepseek-v4-flash",
      requiredSecret: "DEEPSEEK_API_KEY"
    },
    daily: { minimumScore: 60 }
  }, "2026-05-28T01:00:00.000Z", {
    env: { DEEPSEEK_API_KEY1: "test-key" },
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      text: async () => "model unavailable"
    })
  });

  assert.equal(summarized.summaryStats.llmAttempted, 1);
  assert.equal(summarized.summaryStats.llmSucceeded, 0);
  assert.equal(summarized.summaryStats.errorCount, 1);
  assert.equal(summarized.items[0].summary_short, "Existing LLM summary");
  assert.equal(summarized.items[0].ai_model, "deepseek-v4-flash");
});

test("daily summary output builds channel-level important-affairs summaries", async () => {
  const summarized = {
    summaryMethod: "extractive",
    summaryStats: { llmConfigured: false, fallbackCount: 0, errorCount: 0 },
    items: [{
      id: "tech-1",
      title: "AI platform update",
      url: "https://example.test/tech",
      source: "Official Source",
      sourceId: "official-source",
      category: "tech",
      publishedAt: "2026-05-28T00:00:00.000Z",
      score: 92,
      aiSummary: "A platform update changed the developer workflow.",
      summaryReason: "Official Source / tech"
    }, {
      id: "finance-1",
      title: "Market update",
      url: "https://example.test/finance",
      source: "Official Source",
      sourceId: "official-source",
      category: "finance",
      publishedAt: "2026-05-28T00:00:00.000Z",
      score: 91,
      aiSummary: "A market update explained liquidity expectations.",
      summaryReason: "Official Source / finance"
    }, {
      id: "news-1",
      title: "Policy briefing",
      url: "https://example.test/news",
      source: "Public Agency",
      sourceId: "public-agency",
      category: "news",
      publishedAt: "2026-05-28T00:00:00.000Z",
      score: 92,
      aiSummary: "The briefing described a new public policy timeline.",
      summaryReason: "Public Agency / news"
    }]
  };
  const output = await buildDailySummaryOutput(summarized, {
    method: "extractive",
    llmProduction: { enabled: false },
    daily: { maxHighlightsPerChannel: 3 }
  }, "2026-05-28T01:00:00.000Z", { env: {} });

  assert.equal(output.summaryShape, "channel-daily-brief");
  assert.equal(output.totalSummaries, 3);
  assert.deepEqual(output.channelSummaries.map((channel) => channel.id), ["tech", "finance", "news"]);
  const techSummary = output.channelSummaries.find((channel) => channel.id === "tech");
  assert.equal(techSummary.highlights[0].title, "AI platform update");
  assert.match(techSummary.focus, /AI platform update/);
  assert.match(techSummary.whyItMatters, /Official Source/);
  assert.equal(techSummary.watchlist.length, 1);
});

test("daily channel summary uses one DeepSeek call when configured", async () => {
  const rules = {
    method: "extractive",
    llmProduction: {
      enabled: true,
      provider: "deepseek-chat-completions",
      endpoint: "https://api.deepseek.com/chat/completions",
      model: "deepseek-v4-flash",
      requiredSecret: "DEEPSEEK_API_KEY",
      maxRetries: 0,
      maxOutputTokens: 260
    },
    daily: { maxItemsPerChannel: 1, minimumScore: 60, summaryMaxLength: 80, reasonMaxLength: 60 }
  };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              channelSummaries: {
                tech: { overview: "科技重点是平台更新。", keyPoints: ["平台能力变化"] },
                finance: { overview: "金融重点是市场流动性。", keyPoints: ["流动性预期"] },
                news: { overview: "新闻重点是政策时间线。", keyPoints: ["政策执行范围"] }
              }
            })
          }
        }]
      })
    };
  };

  const result = await buildDailyChannelSummaries([
    { id: "tech-1", title: "AI platform update", source: "Official", category: "tech", score: 90, aiSummary: "Platform update.", url: "https://example.test/tech" },
    { id: "finance-1", title: "Market update", source: "Official", category: "finance", score: 90, aiSummary: "Market update.", url: "https://example.test/finance" },
    { id: "news-1", title: "Policy briefing", source: "Official", category: "news", score: 90, aiSummary: "Policy update.", url: "https://example.test/news" }
  ], rules, {
    env: { DEEPSEEK_API_KEY: "test-key" },
    fetchImpl
  });
  const body = JSON.parse(calls[0].init.body);

  assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
  assert.equal(body.model, "deepseek-v4-flash");
  assert.equal(body.response_format.type, "json_object");
  assert.equal(calls.length, 1);
  assert.equal(result.channels.find((channel) => channel.id === "news").overview, "新闻重点是政策时间线。");
  assert.ok(result.channels.find((channel) => channel.id === "tech").focus);
  assert.ok(result.channels.find((channel) => channel.id === "tech").whyItMatters);
  assert.equal(result.stats.llmSucceeded, 1);
});

test("DeepSeek request body uses configured model and JSON mode", () => {
  const body = buildDeepSeekRequestBody("Summarize Developer update as JSON", {
    llmProduction: {
      model: "deepseek-v4-flash"
    },
    daily: { summaryMaxLength: 100, reasonMaxLength: 80 }
  }, {});

  assert.equal(body.model, "deepseek-v4-flash");
  assert.equal(body.response_format.type, "json_object");
  assert.match(body.messages[1].content, /Developer update/);
  assert.match(body.messages[0].content, /JSON/);
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
  assert.match(review.channels.find((channel) => channel.id === "finance").focus, /Central bank update/);
  assert.match(review.channels.find((channel) => channel.id === "finance").whyItMatters, /Federal Reserve/);
  assert.equal(review.channels.find((channel) => channel.id === "news").highlights[0].summary, "The briefing highlighted a global policy issue.");
});

test("weekly review LLM path adds model summaries when DeepSeek is configured", async () => {
  const review = buildWeeklyReview([{
    date: "2026-05-28",
    items: [{
      id: "tech-1",
      title: "AI platform update",
      url: "https://example.test/tech",
      source: "Official Source",
      category: "tech",
      score: 91,
      aiSummary: "A platform update changed the developer workflow.",
      publishedAt: "2026-05-28T00:00:00.000Z"
    }]
  }], {
    weekly: { maxHighlightsPerChannel: 4, maxSourcesPerChannel: 3 }
  }, "2026-05-28T02:00:00.000Z");
  const rules = {
    llmProduction: {
      enabled: true,
      provider: "deepseek-chat-completions",
      endpoint: "https://api.deepseek.com/chat/completions",
      model: "deepseek-v4-flash",
      requiredSecret: "DEEPSEEK_API_KEY"
    }
  };
  const enhanced = await enhanceWeeklyReviewWithLlm(review, rules, "2026-05-28T03:00:00.000Z", {
    env: { DEEPSEEK_API_KEY: "test-key" },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              executiveSummary: "本周科技信息集中在平台更新。",
              channelReviews: {
                tech: { summary: "科技频道关注开发者平台变化。", watchlist: ["继续观察平台更新"] }
              }
            })
          }
        }]
      })
    })
  });

  assert.equal(enhanced.method, "deepseek-chat-completions");
  assert.ok(enhanced.channels.find((channel) => channel.id === "tech").focus);
  assert.ok(enhanced.channels.find((channel) => channel.id === "tech").weekSignals.length);
  assert.equal(enhanced.modelSummary, "本周科技信息集中在平台更新。");
  assert.equal(enhanced.channels.find((channel) => channel.id === "tech").modelSummary, "科技频道关注开发者平台变化。");
});

test("weekly review source filter excludes disabled historical sources", () => {
  const filtered = filterEnabledSourceItems([
    { id: "current", sourceId: "enabled-source", source: "Enabled Source" },
    { id: "old", sourceId: "disabled-source", source: "Disabled Source" }
  ], [
    { id: "enabled-source", name: "Enabled Source", enabled: true },
    { id: "disabled-source", name: "Disabled Source", enabled: false }
  ]);

  assert.deepEqual(filtered.map((item) => item.id), ["current"]);
});
