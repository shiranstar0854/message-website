const test = require("node:test");
const assert = require("node:assert/strict");

const { translateLatestData } = require("../scripts/translate-items");

test("translation marks English items as failed when LLM is not configured", async () => {
  const latest = {
    channels: { tech: { id: "tech", items: [{ id: "en-1" }] } },
    items: [{
      id: "en-1",
      title: "OpenAI signs a new infrastructure agreement",
      summary: "The companies said the partnership remains under discussion.",
      contentExcerpt: "The companies said the partnership remains under discussion.",
      source: "Reuters",
      category: "tech",
      sourceLanguage: "en",
      score: 88
    }]
  };

  const translated = await translateLatestData(latest, {
    llmProduction: { enabled: true, requiredSecret: "DEEPSEEK_API_KEY" }
  }, "2026-06-06T00:00:00.000Z", { env: {} });

  assert.equal(translated.items[0].title_original, "OpenAI signs a new infrastructure agreement");
  assert.equal(translated.items[0].source_language, "en");
  assert.equal(translated.items[0].translation_status, "failed");
  assert.equal(translated.channels.tech.items[0].translation_status, "failed");
  assert.equal(translated.translationStats.failed, 1);
});

test("translation writes Chinese fields and refreshed article keywords on success", async () => {
  const latest = {
    channels: { tech: { id: "tech", items: [{ id: "en-2" }] } },
    items: [{
      id: "en-2",
      title: "AI regulation changes cloud infrastructure strategy",
      summary: "Regulators outlined safety governance for artificial intelligence systems.",
      contentExcerpt: "Regulators outlined safety governance for artificial intelligence systems.",
      source: "OpenAI News",
      category: "tech",
      sourceLanguage: "en",
      score: 93
    }]
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            translatedTitle: "AI 监管改变云基础设施策略",
            aiSummary: "监管机构提出人工智能系统的安全治理要求。",
            summaryReason: "高分科技来源，涉及 AI 政策。",
            importance: "影响云基础设施和 AI 合规部署。",
            impactAreas: ["AI政策", "云基础设施"]
          })
        }
      }]
    })
  });

  const translated = await translateLatestData(latest, {
    llmProduction: {
      enabled: true,
      endpoint: "https://api.deepseek.com/chat/completions",
      provider: "deepseek-chat-completions",
      model: "deepseek-v4-flash",
      requiredSecret: "DEEPSEEK_API_KEY",
      maxRetries: 0
    },
    daily: { summaryMaxLength: 120, reasonMaxLength: 80 }
  }, "2026-06-06T00:00:00.000Z", {
    env: { DEEPSEEK_API_KEY: "test-key" },
    fetchImpl
  });

  assert.equal(translated.items[0].title_zh, "AI 监管改变云基础设施策略");
  assert.equal(translated.items[0].summary_zh, "监管机构提出人工智能系统的安全治理要求。");
  assert.equal(translated.items[0].translated_at, "2026-06-06T00:00:00.000Z");
  assert.equal(translated.items[0].translation_status, "translated");
  assert.ok(translated.items[0].article_keywords.includes("AI政策"));
  assert.equal(translated.translationStats.translated, 1);
});
