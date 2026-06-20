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

test("translation requires AI for every non-Chinese source language", async () => {
  const latest = {
    channels: { news: { id: "news", items: [{ id: "fr-1" }] } },
    items: [{
      id: "fr-1",
      title: "La banque centrale publie une decision",
      summary: "Le communique detaille les prochaines etapes de politique monetaire.",
      contentExcerpt: "Le communique detaille les prochaines etapes de politique monetaire.",
      source: "Banque centrale",
      category: "news",
      sourceLanguage: "fr",
      score: 82
    }]
  };

  const translated = await translateLatestData(latest, {
    llmProduction: { enabled: true, requiredSecret: "DEEPSEEK_API_KEY" }
  }, "2026-06-06T00:00:00.000Z", { env: {} });

  assert.equal(translated.items[0].source_language, "fr");
  assert.equal(translated.items[0].translation_status, "failed");
  assert.equal("title_zh" in translated.items[0], false);
  assert.equal(translated.translationStats.attempted, 1);
  assert.equal(translated.translationStats.notRequired, 0);
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

test("translation writes Chinese fields for non-English foreign-language items", async () => {
  const latest = {
    channels: { news: { id: "news", items: [{ id: "ja-1" }] } },
    items: [{
      id: "ja-1",
      title: "中央銀行が政策判断を発表",
      summary: "声明は金融政策の今後の焦点を説明した。",
      contentExcerpt: "声明は金融政策の今後の焦点を説明した。",
      source: "Official Japan Source",
      category: "news",
      sourceLanguage: "ja",
      score: 91
    }]
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            translatedTitle: "央行发布政策判断",
            summary_short: "央行声明说明了后续货币政策关注点。",
            summary_points: ["央行发布政策判断", "声明说明后续关注点"],
            key_data: [],
            why_it_matters: "会影响市场对政策路径的判断。",
            impact: "可能影响利率预期和资产定价。",
            risks: "具体执行细节不足以判断。",
            neutrality_check: "仅基于原文信息。",
            confidence: "medium"
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
    }
  }, "2026-06-06T00:00:00.000Z", {
    env: { DEEPSEEK_API_KEY: "test-key" },
    fetchImpl
  });

  assert.equal(translated.items[0].source_language, "ja");
  assert.equal(translated.items[0].title_zh, "央行发布政策判断");
  assert.match(translated.items[0].summary_zh, /央行声明说明了后续货币政策关注点/);
  assert.ok(translated.items[0].summary_zh.length > 40);
  assert.equal(translated.items[0].translation_status, "translated");
  assert.equal(translated.translationStats.translated, 1);
});

test("translation retries non-Chinese items until a valid Chinese result is returned", async () => {
  const latest = {
    channels: { news: { id: "news", items: [{ id: "fr-retry" }] } },
    items: [{
      id: "fr-retry",
      title: "La banque centrale publie une decision",
      summary: "Le communique detaille les prochaines etapes.",
      contentExcerpt: "Le communique detaille les prochaines etapes.",
      source: "Banque centrale",
      category: "news",
      sourceLanguage: "fr",
      score: 84
    }]
  };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: calls === 1
              ? JSON.stringify({
                translatedTitle: "",
                summary_short: "",
                summary_points: [],
                key_data: [],
                why_it_matters: "",
                impact: "",
                risks: "",
                neutrality_check: "",
                confidence: "low"
              })
              : JSON.stringify({
                translatedTitle: "央行发布政策决定",
                summary_short: "央行声明说明了后续政策步骤。",
                summary_points: ["央行发布政策决定"],
                key_data: [],
                why_it_matters: "会影响市场对政策路径的判断。",
                impact: "可能影响利率预期。",
                risks: "后续执行细节不足以判断。",
                neutrality_check: "仅基于原文信息。",
                confidence: "medium"
              })
          }
        }]
      })
    };
  };

  const translated = await translateLatestData(latest, {
    llmProduction: {
      enabled: true,
      endpoint: "https://api.deepseek.com/chat/completions",
      provider: "deepseek-chat-completions",
      model: "deepseek-v4-flash",
      requiredSecret: "DEEPSEEK_API_KEY",
      maxRetries: 0,
      requiredTranslationMaxAttempts: 2
    }
  }, "2026-06-06T00:00:00.000Z", {
    env: { DEEPSEEK_API_KEY: "test-key" },
    fetchImpl
  });

  assert.equal(calls, 2);
  assert.equal(translated.items[0].translation_status, "translated");
  assert.equal(translated.items[0].translation_attempts, 2);
  assert.equal(translated.items[0].title_zh, "央行发布政策决定");
});
