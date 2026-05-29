const { truncateText } = require("./pipeline");

const DEFAULT_LLM_PROVIDER = "deepseek-chat-completions";
const DEFAULT_LLM_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEFAULT_LLM_MODEL = "deepseek-v4-flash";
const DEFAULT_SYSTEM_PROMPT = [
  "You write concise Chinese summaries for a public information dashboard.",
  "Use only the provided input.",
  "Do not claim you read the full article unless the excerpt contains it.",
  "Return valid minified JSON only.",
  "Do not use markdown, comments, trailing commas, or line breaks inside string values."
].join(" ");

function getLlmConfig(rules = {}, env = process.env) {
  const llm = rules.llmProduction || {};
  return {
    enabled: Boolean(llm.enabled),
    provider: llm.provider || DEFAULT_LLM_PROVIDER,
    endpoint: llm.endpoint || DEFAULT_LLM_ENDPOINT,
    model: env.DEEPSEEK_MODEL || llm.model || DEFAULT_LLM_MODEL,
    requiredSecret: llm.requiredSecret || "DEEPSEEK_API_KEY",
    timeoutMs: Number(llm.timeoutMs || 30000),
    maxRetries: Number(llm.maxRetries || 0),
    maxOutputTokens: Number(llm.maxOutputTokens || 500),
    fallbackMethod: llm.fallbackMethod || rules.method || "extractive",
    systemPrompt: llm.systemPrompt || DEFAULT_SYSTEM_PROMPT
  };
}

function isLlmConfigured(rules = {}, env = process.env) {
  const config = getLlmConfig(rules, env);
  return Boolean(
    config.enabled
      && config.provider === DEFAULT_LLM_PROVIDER
      && config.endpoint
      && config.model
      && config.requiredSecret
      && env[config.requiredSecret]
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildDeepSeekRequestBody(prompt, rules = {}, env = process.env) {
  const config = getLlmConfig(rules, env);
  return {
    model: config.model,
    messages: [
      { role: "system", content: `${config.systemPrompt} JSON output is required.` },
      { role: "user", content: prompt }
    ],
    response_format: { type: "json_object" },
    max_tokens: config.maxOutputTokens,
    temperature: 0.2
  };
}

function extractChatCompletionText(responseBody) {
  return responseBody?.choices?.[0]?.message?.content || "";
}

function parseJsonResponse(responseText) {
  const trimmed = String(responseText || "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const jsonText = start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed;
  return JSON.parse(jsonText);
}

async function requestDeepSeekJson(prompt, rules = {}, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available in this Node.js runtime");
  }

  const config = getLlmConfig(rules, env);
  const token = env[config.requiredSecret];
  const attempts = Math.max(1, config.maxRetries + 1);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(config.endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildDeepSeekRequestBody(prompt, rules, env)),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = typeof response.text === "function" ? await response.text() : "";
        throw new Error(`DeepSeek API returned ${response.status}: ${truncateText(errorText, 240)}`);
      }

      const responseBody = await response.json();
      return parseJsonResponse(extractChatCompletionText(responseBody));
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < attempts) {
        await sleep(250 * attempt);
      }
    }
  }

  throw lastError;
}

module.exports = {
  DEFAULT_LLM_PROVIDER,
  DEFAULT_LLM_ENDPOINT,
  DEFAULT_LLM_MODEL,
  getLlmConfig,
  isLlmConfigured,
  buildDeepSeekRequestBody,
  extractChatCompletionText,
  parseJsonResponse,
  requestDeepSeekJson
};
