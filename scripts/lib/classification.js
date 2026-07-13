const { normalizeText } = require("./pipeline");

const CANONICAL_CATEGORIES = ["technology", "finance", "business", "macro", "policy", "international", "science", "security"];
const CATEGORY_RULES = {
  technology: /人工智能|大模型|模型|软件|硬件|芯片|云计算|开发者|技术升级|AI|model|software|hardware|chip|cloud|developer|technology/i,
  finance: /股价|债券|基金|融资|估值|投资|资金流|交易|资产价格|stock|bond|fund|financing|valuation|investment|market price/i,
  business: /财报|营收|利润|成本|市场份额|公司战略|并购|经营|earnings|revenue|profit|cost|market share|merger|business/i,
  macro: /国内生产总值|通胀|就业|失业|利率|货币政策|经济数据|gdp|cpi|ppi|inflation|employment|interest rate|monetary policy/i,
  policy: /政策|监管|法律|法规|政府措施|产业政策|审批|policy|regulation|law|government|antitrust/i,
  international: /国际关系|外交|战争|冲突|制裁|关税|跨境|联合国|geopolit|diplom|war|conflict|sanction|tariff|cross-border|united nations/i,
  science: /科学|研究成果|论文|实验|临床试验|太空|物理|生物|research result|paper|experiment|clinical trial|space|physics|biology/i,
  security: /网络安全|漏洞|攻击|入侵|泄露|恶意软件|security|vulnerability|breach|cyberattack|malware|ransomware/i
};
const SECONDARY_TAG_RULES = [
  ["人工智能", /人工智能|大模型|\bAI\b|artificial intelligence/i],
  ["芯片与算力", /芯片|半导体|算力|GPU|semiconductor|compute/i],
  ["软件与开发者", /软件|开发者|开源|API|software|developer|open source/i],
  ["网络安全", /网络安全|漏洞|攻击|泄露|cyber|security|vulnerability|breach/i],
  ["产业政策", /产业政策|补贴|产业规划|industrial policy|subsidy/i],
  ["监管执法", /监管|执法|反垄断|regulation|enforcement|antitrust/i],
  ["货币政策", /央行|利率|货币政策|central bank|interest rate|monetary policy/i],
  ["经济数据", /GDP|CPI|PPI|通胀|就业|经济数据|inflation|employment/i],
  ["资本市场", /股价|债券|基金|交易所|stock|bond|fund|exchange/i],
  ["融资与并购", /融资|估值|投资|并购|financing|valuation|investment|merger/i],
  ["财报与指引", /财报|营收|利润|指引|earnings|revenue|profit|guidance/i],
  ["国际贸易", /关税|出口|进口|贸易|tariff|export|import|trade/i],
  ["地缘政治", /外交|战争|冲突|制裁|geopolit|war|conflict|sanction/i],
  ["科研成果", /论文|实验|研究成果|paper|experiment|research result/i]
];

function classificationText(item) {
  return normalizeText(`${item.title || ""} ${item.summary || ""} ${item.contentExcerpt || ""} ${item.bodyText || ""} ${(item.tags || []).join(" ")}`);
}

function categoryScores(item, metadataOnly = false) {
  const text = metadataOnly
    ? normalizeText(`${item.title || ""} ${item.summary || ""} ${(item.tags || []).join(" ")}`)
    : classificationText(item);
  const scores = Object.fromEntries(CANONICAL_CATEGORIES.map((category) => {
    const matches = text.match(new RegExp(CATEGORY_RULES[category].source, "gi")) || [];
    const titleMatch = CATEGORY_RULES[category].test(item.title || "") ? 0.35 : 0;
    return [category, Math.min(1, matches.length * 0.18 + titleMatch)];
  }));
  const eventBoosts = {
    security_incident: ["security", 0.5], policy_change: ["policy", 0.45],
    economic_data: ["macro", 0.45], earnings_guidance: ["business", 0.45],
    research_result: ["science", 0.4], market_move: ["finance", 0.35],
    technology_upgrade: ["technology", 0.35], product_launch: ["technology", 0.25]
  };
  const boost = eventBoosts[item.eventType];
  if (boost) scores[boost[0]] += boost[1];
  return scores;
}

function rankedScores(item, metadataOnly = false) {
  return Object.entries(categoryScores(item, metadataOnly)).sort((left, right) => right[1] - left[1]);
}

function sourceFallbackCategory(item) {
  const map = { tech: "technology", finance: "finance", business: "business", macro: "macro", international: "international", news: "policy" };
  return map[item.sourceCategory || item.category] || "business";
}

function classifyMetadataCategory(item) {
  const ranked = rankedScores(item, true);
  return ranked[0][1] > 0 ? ranked[0][0] : sourceFallbackCategory(item);
}

function factorText(item, kind) {
  const text = classificationText(item);
  const patterns = {
    subject: /([A-Z][A-Za-z0-9 .&-]{2,}|[\u4e00-\u9fff]{2,}(?:公司|部门|委员会|银行|政府|大学))/u,
    action: /(发布|推出|批准|宣布|报告|升级|投资|收购|监管|released|launched|approved|announced|reported|upgraded|invested|acquired)/i,
    object: /(模型|产品|政策|市场|公司|经济|研究|安全|model|product|policy|market|company|economy|research|security)/i,
    impact: /(影响|导致|推动|限制|提高|降低|impact|cause|drive|limit|increase|decrease)/i
  };
  return text.match(patterns[kind])?.[0] || "证据中未明确说明";
}

function secondaryTags(item) {
  const text = classificationText(item);
  const tags = SECONDARY_TAG_RULES.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  const entities = [...text.matchAll(/(?:[A-Z][A-Za-z0-9&.-]{2,}|[\u4e00-\u9fff]{2,10}(?:公司|银行|大学|委员会|部门))/gu)]
    .map((match) => match[0]).filter((value) => value.length <= 24);
  return [...new Set([...tags, ...entities, ...(item.tags || []).map(normalizeText).filter(Boolean)])].slice(0, 6);
}

function classifyLocally(item) {
  const ranked = rankedScores(item);
  const fallback = sourceFallbackCategory(item);
  const category = ranked[0][1] > 0 ? ranked[0][0] : fallback;
  const topScore = ranked[0][1];
  const secondScore = ranked[1][1];
  const confidence = topScore > 0
    ? Math.max(0.45, Math.min(0.96, 0.55 + topScore * 0.3 + Math.max(0, topScore - secondScore) * 0.25))
    : 0.45;
  const conflicts = ranked.slice(1, 3).filter(([, score]) => topScore - score < 0.12).map(([name]) => name);
  const sourceMapped = sourceFallbackCategory(item);
  const scores = Object.fromEntries(ranked);
  const sourceConflict = sourceMapped !== category && (scores[sourceMapped] || 0) > 0.25;
  const technologyFinanceClose = Math.abs((scores.technology || 0) - (scores.finance || 0)) < 0.12
    && Math.max(scores.technology || 0, scores.finance || 0) > 0;
  const requiresReview = confidence < 0.72 || topScore - secondScore < 0.12 || technologyFinanceClose || sourceConflict || topScore === 0;
  return {
    category,
    sourceCategory: item.sourceCategory || item.category || "",
    secondaryTags: secondaryTags(item),
    classification: {
      confidence: Number(confidence.toFixed(2)),
      reason: topScore > 0 ? `根据主体、动作、对象和影响特征，${category} 得分最高。` : `正文特征不足，暂以来源类别映射为 ${category}。`,
      factors: { subject: factorText(item, "subject"), action: factorText(item, "action"), object: factorText(item, "object"), impact: factorText(item, "impact") },
      candidateConflicts: conflicts,
      method: "rule",
      status: requiresReview ? "review-required" : "classified"
    },
    classificationScores: scores,
    requiresReview
  };
}

function validateModelClassification(value, fallback) {
  if (!value || !CANONICAL_CATEGORIES.includes(value.category)) return null;
  const confidence = Number(value.confidence);
  return {
    ...fallback,
    category: value.category,
    secondaryTags: Array.isArray(value.secondaryTags) ? value.secondaryTags.map(normalizeText).filter(Boolean).slice(0, 6) : fallback.secondaryTags,
    classification: {
      ...fallback.classification,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : fallback.classification.confidence,
      reason: normalizeText(value.reason) || fallback.classification.reason,
      candidateConflicts: Array.isArray(value.candidateConflicts) ? value.candidateConflicts.filter((entry) => CANONICAL_CATEGORIES.includes(entry)) : [],
      method: "rule+llm-review",
      status: "classified"
    },
    requiresReview: false
  };
}

module.exports = { CANONICAL_CATEGORIES, CATEGORY_RULES, classifyMetadataCategory, classifyLocally, validateModelClassification };
