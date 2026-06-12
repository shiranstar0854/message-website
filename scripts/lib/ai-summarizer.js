const PROHIBITED_TERMS = [
  "重大",
  "革命性",
  "颠覆性",
  "史诗级",
  "爆炸性",
  "game-changing",
  "revolutionary",
  "disruptive"
];

const CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);
const DATA_PATTERN = /(\d+(?:\.\d+)?\s?(?:%|pct|bps|bp|亿美元|亿元|万元|美元|人民币|人|家|项|条|倍|年|月|日)|[A-Z]{2,6}\s?\d{1,4})/gi;
const ACTION_PATTERN = /(发布|推出|批准|禁止|调查|起诉|处罚|下调|上调|收购|投资|合作|融资|裁员|召回|launch|release|approve|ban|invest|acquire|merge|recall|lawsuit|guidance|earnings|revenue|profit)/i;
const IMPORTANT_TOPIC_PATTERN = /(政策|监管|财报|产品|发布|宏观|通胀|利率|GDP|CPI|PPI|央行|美联储|SEC|证监|披露|earnings|revenue|guidance|regulation|policy|product|launch|macro|inflation|central bank|federal reserve)/i;

function normalizeText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value, limit = 180) {
  const text = normalizeText(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function splitSentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+|(?<=[\u3002\uff01\uff1f])\s*|\n+/u)
    .map((sentence) => normalizeText(sentence))
    .filter(Boolean);
}

function cleanUnsupportedLanguage(value) {
  let text = normalizeText(value);
  PROHIBITED_TERMS.forEach((term) => {
    text = text.replace(new RegExp(term, "gi"), "");
  });
  return normalizeText(text);
}

function uniqueList(values, limit = 5) {
  const seen = new Set();
  const result = [];
  (values || []).forEach((value) => {
    const text = cleanUnsupportedLanguage(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    result.push(text);
  });
  return result.slice(0, limit);
}

function extractKeyData(text, limit = 5) {
  return uniqueList([...normalizeText(text).matchAll(DATA_PATTERN)].map((match) => match[0]), limit);
}

function sourceCredibilityScore(item) {
  if (["official-agency", "official-market", "official-media"].includes(item.sourceAuthority)) return 24;
  if (item.sourceAuthority === "financial-media") return 18;
  if (item.sourceAuthority === "media") return 12;
  return 8;
}

function calculateImportanceScore(item, structured = {}) {
  const text = normalizeText([
    item.title,
    item.summary,
    item.contentExcerpt,
    structured.summary_short,
    structured.why_it_matters,
    structured.impact,
    ...(item.article_keywords || []),
    ...(item.keywords || []),
    ...(item.impactAreas || [])
  ].filter(Boolean).join(" "));

  const base = Math.round(Number(item.score || 0) * 0.32);
  const source = sourceCredibilityScore(item);
  const impact = (item.impactAreas || item.article_keywords || item.keywords || []).length ? 10 : 0;
  const topic = IMPORTANT_TOPIC_PATTERN.test(text) ? 18 : 0;
  const event = item.timeline_event_id || structured.timeline_event_id ? 8 : 0;
  const data = extractKeyData(text).length ? 10 : 0;
  const action = ACTION_PATTERN.test(text) ? 8 : 0;
  const duplicate = Math.min(6, Number(item.duplicateCount || 0) * 2);

  return Math.max(0, Math.min(100, base + source + impact + topic + event + data + action + duplicate));
}

function buildStructuredSummaryPrompt(item) {
  return [
    "You are an information analyst for a Chinese news filtering website.",
    "Return strict valid JSON only. Do not wrap JSON in markdown. Do not include comments.",
    "Use only the provided source material. Do not invent facts, numbers, causes, or outcomes.",
    "Separate facts, inference, impact, and risk. If evidence is insufficient, write \"不足以判断\".",
    "Do not use unsupported hype words such as 重大, 革命性, 颠覆性, game-changing, revolutionary, disruptive.",
    "Do not repeat the title as the summary. Keep professional terms, but explain naturally in Chinese.",
    "The summary must be denser than the source text.",
    "Return exactly this JSON shape:",
    "{\"translatedTitle\":\"\",\"summary_short\":\"\",\"summary_points\":[],\"key_data\":[],\"why_it_matters\":\"\",\"impact\":\"\",\"risks\":\"\",\"neutrality_check\":\"\",\"confidence\":\"high | medium | low\"}",
    "",
    JSON.stringify({
      title: item.title,
      content: item.contentExcerpt || item.summary || "",
      source: item.source,
      published_at: item.publishedAt,
      url: item.url
    }, null, 2)
  ].join("\n");
}

function validateStructuredSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI summary response must be a JSON object.");
  }

  const cleaned = {
    summary_short: cleanUnsupportedLanguage(value.summary_short),
    summary_points: uniqueList(Array.isArray(value.summary_points) ? value.summary_points : [], 5),
    key_data: uniqueList(Array.isArray(value.key_data) ? value.key_data : [], 8),
    why_it_matters: cleanUnsupportedLanguage(value.why_it_matters),
    impact: cleanUnsupportedLanguage(value.impact),
    risks: cleanUnsupportedLanguage(value.risks),
    neutrality_check: cleanUnsupportedLanguage(value.neutrality_check),
    confidence: CONFIDENCE_VALUES.has(String(value.confidence || "").toLowerCase())
      ? String(value.confidence).toLowerCase()
      : "low"
  };

  if (!cleaned.summary_short && cleaned.summary_points.length === 0) {
    throw new Error("AI summary response is empty.");
  }

  return cleaned;
}

function buildExtractiveStructuredSummary(item, generatedAt = new Date().toISOString(), model = "extractive") {
  const sourceText = normalizeText(item.contentExcerpt || item.summary || item.aiSummary || item.title || "");
  const sentences = splitSentences(sourceText);
  const firstUseful = sentences.find((sentence) => sentence.length >= 18) || sentences[0] || item.title || "不足以判断";
  const points = uniqueList([
    firstUseful,
    ...sentences.filter((sentence) => sentence !== firstUseful)
  ].map((sentence) => truncateText(sentence, 140)), 5);
  const keyData = extractKeyData(sourceText);
  const confidence = sourceText.length >= 120 ? "medium" : "low";
  const structured = validateStructuredSummary({
    summary_short: truncateText(firstUseful, 90),
    summary_points: points.length ? points : ["不足以判断"],
    key_data: keyData,
    why_it_matters: item.importance || item.summaryReason || "不足以判断",
    impact: item.impactAreas?.length ? `可能影响：${item.impactAreas.slice(0, 3).join("、")}` : "不足以判断",
    risks: sourceText.length >= 80 ? "原文未充分说明后续结果，需继续跟踪。" : "信息不足以判断。",
    neutrality_check: "仅基于原文可见信息生成，未加入外部事实。",
    confidence
  });

  return {
    ...structured,
    timeline_event_id: item.timeline_event_id || "",
    original_url: item.original_url || item.url || "",
    ai_model: model,
    ai_generated_at: generatedAt,
    importance_score: calculateImportanceScore(item, structured)
  };
}

function buildStructuredFieldsFromResponse(item, responseJson, generatedAt, model) {
  const structured = validateStructuredSummary(responseJson);
  return {
    ...structured,
    timeline_event_id: item.timeline_event_id || "",
    original_url: item.original_url || item.url || "",
    ai_model: model,
    ai_generated_at: generatedAt,
    importance_score: calculateImportanceScore(item, structured)
  };
}

module.exports = {
  PROHIBITED_TERMS,
  buildStructuredSummaryPrompt,
  validateStructuredSummary,
  buildExtractiveStructuredSummary,
  buildStructuredFieldsFromResponse,
  calculateImportanceScore,
  extractKeyData
};
