const fs = require("node:fs");
const path = require("node:path");
const { readJson } = require("./lib/file-utils");
const { titleSimilarity } = require("./lib/pipeline");

const ROOT_DIR = path.resolve(__dirname, "..");
const LATEST_PATH = path.join(ROOT_DIR, "src", "data", "latest-items.json");
const EVENTS_PATH = path.join(ROOT_DIR, "src", "data", "events.json");
const MARKET_CONTEXT_PATH = path.join(ROOT_DIR, "src", "data", "market-context.json");
const ARCHIVE_DIR = path.join(ROOT_DIR, "data", "archive", "daily");
const EVENT_LOOKBACK_DAYS = 90;
const EVENT_TRACKING_SCHEMA_VERSION = "event-tracking.v4";

const DECISION_LANES = [
  {
    id: "us_equities",
    label: "美股变化",
    description: "追踪影响美股、科技股、指数、估值和市场预期的重点事件。"
  },
  {
    id: "china_us_ai",
    label: "中美 AI 发展",
    description: "追踪中美 AI、算力、模型、芯片、监管和产业竞争相关事件。"
  },
  {
    id: "china_policy",
    label: "中国权威政策落地",
    description: "追踪中国官方政策、监管文件、产业政策和落地执行进展。"
  }
];

const EVENT_RULES = [
  { id: "ai-policy", label: "AI 政策与基础设施", pattern: /(\bai\b|artificial intelligence|大模型|人工智能|算力|芯片|AI政策)/i },
  { id: "macro-policy", label: "宏观政策与利率", pattern: /(\bgdp\b|\bcpi\b|\bppi\b|\binflation\b|central bank|federal reserve|rate decision|interest rate|\brate\b|财政|货币政策|宏观|通胀|利率|央行|美联储)/i },
  { id: "market-regulation", label: "金融监管与市场结构", pattern: /(sec|csrc|market structure|exchange|disclosure|监管|证监会|交易所|披露|金融风险)/i },
  { id: "business-cycle", label: "商业经营与产业竞争", pattern: /(\bearnings\b|\brevenue\b|\bprofit\b|\bipo\b|\bmerger\b|\bcompany\b|\bbusiness\b|财报|营收|利润|上市|并购|公司|企业|商业)/i },
  { id: "global-affairs", label: "国际关系与跨境影响", pattern: /(\bglobal\b|international|geopolitic|sanction|tariff|election|diplomacy|全球|国际|地缘|制裁|关税|选举|外交)/i }
];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const US_EQUITY_SYMBOLS = ["NVDA", "MSFT", "GOOGL", "META", "AMZN", "AMD", "AVGO", "TSLA", "QQQ", "SPY", "SMH"];
const US_EQUITY_ALIASES = [
  { symbol: "NVDA", labels: ["NVDA", "NVIDIA", "\u82f1\u4f1f\u8fbe"] },
  { symbol: "MSFT", labels: ["MSFT", "Microsoft", "\u5fae\u8f6f"] },
  { symbol: "GOOGL", labels: ["GOOGL", "Google", "Alphabet", "\u8c37\u6b4c"] },
  { symbol: "META", labels: ["META", "Meta", "Facebook"] },
  { symbol: "AMZN", labels: ["AMZN", "Amazon", "AWS", "\u4e9a\u9a6c\u900a"] },
  { symbol: "AMD", labels: ["AMD", "Advanced Micro Devices"] },
  { symbol: "AVGO", labels: ["AVGO", "Broadcom", "\u535a\u901a"] },
  { symbol: "TSLA", labels: ["TSLA", "Tesla", "\u7279\u65af\u62c9", "Elon Musk", "Musk", "\u9a6c\u65af\u514b", "SpaceX", "Starship", "Starlink"] },
  { symbol: "QQQ", labels: ["QQQ", "Nasdaq", "Nasdaq 100", "\u7eb3\u65af\u8fbe\u514b"] },
  { symbol: "SPY", labels: ["SPY", "S&P 500", "\u6807\u666e500"] },
  { symbol: "SMH", labels: ["SMH", "semiconductor ETF", "chip ETF", "\u534a\u5bfc\u4f53ETF"] }
];
const AI_ENTITY_ALIASES = ["AI", "artificial intelligence", "OpenAI", "Google", "Microsoft", "GitHub", "NVIDIA", "compute", "chip", "model", "\u4eba\u5de5\u667a\u80fd", "\u5927\u6a21\u578b", "\u7b97\u529b", "\u82af\u7247"];
const CHINA_POLICY_SOURCES = ["\u56fd\u52a1\u9662", "\u4e2d\u56fd\u653f\u5e9c\u7f51", "\u4eba\u6c11\u94f6\u884c", "\u4e2d\u56fd\u4eba\u6c11\u94f6\u884c", "\u8bc1\u76d1\u4f1a", "\u4e2d\u56fd\u8bc1\u76d1\u4f1a", "\u53d1\u6539\u59d4", "\u56fd\u5bb6\u53d1\u5c55\u6539\u9769\u59d4", "\u8d22\u653f\u90e8", "\u7edf\u8ba1\u5c40", "\u56fd\u5bb6\u7edf\u8ba1\u5c40", "\u79d1\u6280\u90e8", "\u5de5\u4fe1\u90e8"];
const CHINA_POLICY_PATTERN = /(\u653f\u7b56|\u76d1\u7ba1|\u901a\u77e5|\u529e\u6cd5|\u610f\u89c1|\u8bd5\u70b9|\u6267\u884c|\u843d\u5730|\u5904\u7f5a|\u6267\u6cd5|\u53d1\u5e03|\u5f81\u6c42\u610f\u89c1|\u56fd\u52a1\u9662|\u4eba\u6c11\u94f6\u884c|\u8bc1\u76d1\u4f1a|\u53d1\u6539\u59d4|\u8d22\u653f\u90e8|\u7edf\u8ba1\u5c40|\u79d1\u6280\u90e8|\u5de5\u4fe1\u90e8)/i;
const CHINA_POLICY_ACTION_PATTERN = /(\u653f\u7b56|\u76d1\u7ba1|\u901a\u77e5|\u529e\u6cd5|\u610f\u89c1|\u8bd5\u70b9|\u6267\u884c|\u843d\u5730|\u5904\u7f5a|\u6267\u6cd5|\u53d1\u5e03|\u516c\u5e03|\u5f81\u6c42\u610f\u89c1|\u5b9e\u65bd|\u65bd\u884c|\u89c4\u5212|policy|regulation|notice|implementation|effective|proposal|pilot)/i;
const CHINA_POLICY_EXCLUDE_PATTERN = /(\u4efb\u547d|\u4f1a\u89c1|\u4f1a\u8c08|\u901a\u7535\u8bdd|\u62db\u5f85\u4f1a|\u62b5\u8fbe|\u8bbf\u95ee|\u515a\u5efa|\u5916\u4ea4\u90e8\u957f|\u5916\u957f)/i;
const POLICY_STATUS_RULES = [
  { status: "\u76d1\u7ba1\u5904\u7f5a", pattern: /(\u5904\u7f5a|\u6267\u6cd5|\u516c\u5f00\u8c34\u8d23|penalty|enforcement|sanction)/i },
  { status: "\u5f81\u6c42\u610f\u89c1", pattern: /(\u5f81\u6c42\u610f\u89c1|consultation|proposal|proposed)/i },
  { status: "\u8bd5\u70b9", pattern: /(\u8bd5\u70b9|pilot)/i },
  { status: "\u843d\u5730\u6267\u884c", pattern: /(\u843d\u5730|\u6267\u884c|\u5b9e\u65bd|\u65bd\u884c|effective|implementation)/i },
  { status: "\u53d1\u5e03", pattern: /(\u53d1\u5e03|\u516c\u5e03|announce|release|issued)/i }
];

function hasChineseText(value) {
  return /[\u4e00-\u9fff]/u.test(String(value || ""));
}

function isChineseLanguage(language) {
  const value = normalizeText(language).toLowerCase();
  return value === "zh" || value.startsWith("zh-") || value === "cn" || value === "chinese";
}

function inferredLanguage(item) {
  const explicit = normalizeText(item.source_language || item.sourceLanguage || "").toLowerCase();
  if (explicit) return explicit;
  const text = normalizeText(`${item.title || ""} ${item.summary || ""} ${item.contentExcerpt || ""}`);
  if (/[\u3040-\u30ff\uac00-\ud7af]/u.test(text)) return "non-zh";
  if (/[A-Za-z]/.test(text) && !hasChineseText(text)) return "en";
  if (hasChineseText(text)) return "zh";
  return "unknown";
}

function needsChineseTranslation(item) {
  return !isChineseLanguage(inferredLanguage(item));
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "event";
}

function itemKeywords(item) {
  return [...new Set([
    ...(item.article_keywords || []),
    ...(item.keywords || []),
    ...(item.impactAreas || []),
    ...(item.tags || [])
  ].map(normalizeText).filter(Boolean))];
}

function itemText(item) {
  return normalizeText([
    item.title_zh,
    item.titleZh,
    item.translatedTitle,
    item.title,
    item.summary_zh,
    item.summaryZh,
    item.aiSummary,
    item.summary,
    item.contentExcerpt,
    item.category,
    item.primaryCategory,
    ...itemKeywords(item),
    ...(item.tags || [])
  ].filter(Boolean).join(" "));
}

function ruleForItem(item) {
  const text = itemText(item);
  return EVENT_RULES.find((rule) => rule.pattern.test(text));
}

function displayTitle(item) {
  return item.title_zh || item.titleZh || item.translatedTitle || item.title || "未命名信息";
}

function displaySummary(item) {
  return item.summary_zh || item.summaryZh || item.summary_short || item.aiSummary || item.contentExcerpt || item.summary || "";
}

function isEventReadyItem(item) {
  if (!needsChineseTranslation(item)) return true;
  const translated = normalizeText(item.translation_status || item.translationStatus).toLowerCase() === "translated";
  return translated && hasChineseText(displayTitle(item)) && hasChineseText(displaySummary(item));
}

function compactSentence(value, limit = 110) {
  const text = normalizeText(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function buildEventSummary(items, label) {
  const top = items[0] || {};
  const sources = [...new Set(items.map((item) => item.source).filter(Boolean))].slice(0, 3);
  return [
    compactSentence(displaySummary(top) || `${label} 出现连续报道。`, 110),
    sources.length ? `相关来源：${sources.join("、")}` : ""
  ].filter(Boolean).join(" ");
}

function uniqueValues(values, limit) {
  return [...new Set(values.map(normalizeText).filter(Boolean))].slice(0, limit);
}

function lowerText(value) {
  return normalizeText(value).toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAnyText(text, values) {
  const lower = lowerText(text);
  return values.some((value) => {
    const normalized = lowerText(value);
    if (!normalized) return false;
    if (/^[a-z0-9]{1,3}$/i.test(normalized)) {
      return new RegExp(`\\b${escapeRegExp(normalized)}\\b`, "i").test(lower);
    }
    return lower.includes(normalized);
  });
}

function itemDecisionText(item) {
  return normalizeText([
    itemText(item),
    item.source,
    item.url,
    item.why_it_matters,
    item.impact,
    item.risks,
    ...(item.summary_points || []),
    ...(item.key_data || [])
  ].filter(Boolean).join(" "));
}

function itemPolicyText(item) {
  return normalizeText([
    displayTitle(item),
    item.title,
    item.title_zh,
    item.summary_zh,
    item.aiSummary,
    item.why_it_matters,
    item.impact,
    item.risks,
    ...(item.summary_points || []),
    ...(item.key_data || [])
  ].filter(Boolean).join(" "));
}

function itemAiContentText(item) {
  return normalizeText([
    displayTitle(item),
    item.title,
    item.title_zh,
    item.summary_zh,
    item.aiSummary,
    item.why_it_matters,
    item.impact,
    item.risks,
    ...(item.summary_points || []),
    ...(item.key_data || [])
  ].filter(Boolean).join(" "));
}

function extractTickersFromText(text) {
  const lower = lowerText(text);
  const tickers = new Set();
  US_EQUITY_ALIASES.forEach((entry) => {
    if (entry.labels.some((label) => lower.includes(lowerText(label)))) {
      tickers.add(entry.symbol);
    }
  });
  [...String(text || "").matchAll(/\b[A-Z]{2,5}\b/g)]
    .map((match) => match[0])
    .filter((symbol) => US_EQUITY_SYMBOLS.includes(symbol))
    .forEach((symbol) => tickers.add(symbol));
  return [...tickers];
}

function extractRelatedEntities(items, tickers = []) {
  const text = items.map(itemDecisionText).join(" ");
  const entities = new Set(tickers);
  US_EQUITY_ALIASES.forEach((entry) => {
    entry.labels.forEach((label) => {
      if (hasAnyText(text, [label])) entities.add(label);
    });
  });
  [...AI_ENTITY_ALIASES, ...CHINA_POLICY_SOURCES, "NASA", "FAA", "FCC", "SEC", "Federal Reserve"].forEach((label) => {
    if (hasAnyText(text, [label])) entities.add(label);
  });
  return [...entities].slice(0, 12);
}

function marketSymbolsFromContext(marketContext = {}) {
  const symbols = marketContext.symbols || {};
  return new Set(Object.keys(symbols).filter((symbol) => symbols[symbol] && symbols[symbol].status !== "missing"));
}

function buildEventMarketContext(items, marketContext = {}) {
  const text = items.map(itemDecisionText).join(" ");
  const inferredTickers = extractTickersFromText(text);
  const available = marketSymbolsFromContext(marketContext);
  const symbols = {};
  inferredTickers.forEach((symbol) => {
    if (marketContext.symbols?.[symbol]) symbols[symbol] = marketContext.symbols[symbol];
  });
  const hasMarketData = inferredTickers.some((symbol) => available.has(symbol));
  const topMovers = (marketContext.topMovers || [])
    .filter((entry) => inferredTickers.includes(entry.symbol))
    .slice(0, 5);
  return {
    tickers: inferredTickers,
    symbols,
    topMovers,
    hasMarketData,
    status: marketContext.status || (Object.keys(marketContext.symbols || {}).length ? "available" : "missing"),
    generatedAt: marketContext.generatedAt || "",
    stale: Boolean(marketContext.stale)
  };
}

function isChinaPolicySource(item) {
  const source = `${item.source || ""} ${item.sourceId || ""} ${item.url || ""}`;
  return hasAnyText(source, CHINA_POLICY_SOURCES);
}

function isChinaPolicyContentItem(item) {
  const text = itemPolicyText(item);
  const titleText = normalizeText([displayTitle(item), item.title, item.title_zh, item.summary_zh].filter(Boolean).join(" "));
  return isChinaPolicySource(item)
    && CHINA_POLICY_ACTION_PATTERN.test(text)
    && !CHINA_POLICY_EXCLUDE_PATTERN.test(titleText);
}

function isAiDecisionItem(item) {
  return hasAnyText(itemDecisionText(item), AI_ENTITY_ALIASES);
}

function isStrongAiDecisionItem(item) {
  const specificKeywords = itemKeywords(item).filter((keyword) => lowerText(keyword) !== "ai");
  const compactText = [
    displayTitle(item),
    item.title,
    item.source,
    ...specificKeywords
  ].filter(Boolean).join(" ");
  return hasAnyText(compactText, AI_ENTITY_ALIASES);
}

function isOfficialSource(item) {
  if (["official-agency", "official-market", "official-media"].includes(item.sourceAuthority)) return true;
  return isChinaPolicySource(item);
}

function isKnownAiSource(item) {
  const source = `${item.source || ""} ${item.sourceId || ""} ${item.url || ""}`;
  return hasAnyText(source, [
    "OpenAI News",
    "Google AI Blog",
    "Microsoft Azure Blog",
    "GitHub Blog",
    "CISA News"
  ]);
}

function isAiContentItem(item) {
  return hasAnyText(itemAiContentText(item), AI_ENTITY_ALIASES) || isKnownAiSource(item);
}

function isTrustedAiAnchorItem(item) {
  if (!isStrongAiDecisionItem(item) || !isAiContentItem(item)) return false;
  if (isKnownAiSource(item)) return true;
  return isOfficialSource(item) || item.sourceAuthority === "financial-media";
}

function forcedDecisionLaneForItem(item) {
  if (extractTickersFromText(itemDecisionText(item)).length) return "";
  if (isChinaPolicyContentItem(item)) return "china_policy";
  if (isTrustedAiAnchorItem(item)) return "china_us_ai";
  return "";
}

function isCompatibleWithForcedLane(item, lane) {
  if (lane === "china_policy") return isChinaPolicyContentItem(item);
  if (lane === "china_us_ai") return isAiContentItem(item);
  return false;
}

function eventDecisionLane(items, eventMarketContext) {
  if (eventMarketContext.tickers.length || eventMarketContext.hasMarketData) return "us_equities";
  const policyItems = items.filter(isChinaPolicyContentItem);
  if (policyItems.length >= 2) return "china_policy";
  const aiItems = items.filter(isAiContentItem);
  const aiAnchorItems = items.filter(isTrustedAiAnchorItem);
  if (aiItems.length >= 2 && aiAnchorItems.length >= 1) return "china_us_ai";
  return "";
}

function focusItemsForDecisionLane(items, lane) {
  if (lane === "china_policy") return items.filter(isChinaPolicyContentItem);
  if (lane === "china_us_ai") return items.filter(isAiContentItem);
  return items;
}

function buildPolicyStatus(items, lane) {
  if (lane !== "china_policy") return "";
  const text = items.map(itemPolicyText).join(" ");
  const match = POLICY_STATUS_RULES.find((rule) => rule.pattern.test(text));
  return match?.status || "\u53d1\u5e03";
}

function buildSourceQuality(items, timeline, eventMarketContext) {
  const sourceCount = uniqueValues(items.map((item) => item.source), 20).length;
  const officialCount = items.filter(isOfficialSource).length;
  const financialMediaCount = items.filter((item) => item.sourceAuthority === "financial-media").length;
  const confidence = officialCount > 0 && (sourceCount >= 2 || eventMarketContext.hasMarketData) ? "high"
    : officialCount > 0 || sourceCount >= 2 ? "medium"
      : "low";
  return {
    sourceCount,
    officialCount,
    financialMediaCount,
    timelineCount: timeline.length,
    confidence
  };
}

function decisionGrade(lane, sourceQuality, eventMarketContext, topScore) {
  if (!lane) return "C";
  if (lane === "us_equities" && !eventMarketContext.tickers.length && !eventMarketContext.hasMarketData) return "C";
  if (lane === "china_policy" && sourceQuality.officialCount < 1) return "C";
  if (sourceQuality.confidence === "high" && sourceQuality.timelineCount >= 2 && Number(topScore || 0) >= 75) return "A";
  if (sourceQuality.confidence !== "low" && sourceQuality.timelineCount >= 2 && Number(topScore || 0) >= 60) return "B";
  return "C";
}

function decisionSignal(grade) {
  if (grade === "A") return "\u4f18\u5148\u8ddf\u8e2a";
  if (grade === "B") return "\u89c2\u5bdf\u9a8c\u8bc1";
  return "\u6682\u4e0d\u884c\u52a8";
}

function decisionLaneLabel(lane) {
  return DECISION_LANES.find((item) => item.id === lane)?.label || "\u91cd\u70b9\u4e8b\u4ef6";
}

function decisionLaneDescription(lane) {
  return DECISION_LANES.find((item) => item.id === lane)?.description || "";
}

function priorityGradeValue(grade) {
  return ["A", "B", "C"].includes(grade) ? grade : "C";
}

function firstSeenAt(items = [], fallback = "") {
  return items
    .map((item) => item.publishedAt)
    .filter(Boolean)
    .sort()[0] || fallback;
}

function confidenceBasis(sourceQuality = {}) {
  return sourceQuality.confidence || "medium";
}

function evidenceTypeCounts(items = []) {
  return items.reduce((counts, item) => {
    const type = evidenceTypeForItem(item);
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
}

function structuredSourceLink(item = {}) {
  return {
    title: item.title || "",
    source: item.source || "",
    url: item.url || "",
    published_at: item.publishedAt || item.published_at || "",
    summary: item.summary || "",
    relevance_score: Number(item.score || item.relevance_score || 0)
  };
}

function factObjects(facts = [], evidenceItems = [], confidence = "中") {
  return (facts || []).slice(0, 8).map((fact, index) => {
    const evidence = evidenceItems[index] || evidenceItems[0] || {};
    return {
      fact: typeof fact === "string" ? fact : normalizeText(fact.fact || fact.text || fact.summary),
      evidence_url: evidence.url || fact.evidence_url || "",
      source: evidence.source || fact.source || "",
      confidence
    };
  }).filter((item) => item.fact);
}

function impactCell(impact, evidence, confidence = "中") {
  return {
    impact: impact || "目前证据不足",
    evidence,
    uncertainty: "后续影响仍需要更多来源和市场反馈验证。",
    confidence
  };
}

function structuredImpact(legacyImpact = {}, evidence = [], confidence = "中") {
  return {
    market: impactCell(legacyImpact.market, evidence, confidence),
    industry: impactCell(legacyImpact.industry, evidence, confidence),
    company: impactCell(legacyImpact.company, evidence, confidence),
    user_or_developer: impactCell(legacyImpact.user_or_developer || legacyImpact.user, evidence, confidence),
    policy_or_regulation: impactCell(legacyImpact.policy_or_regulation || "目前证据不足", evidence, "低")
  };
}

function structuredMarketFeedback(values = [], latestUpdate = {}) {
  return (values || []).slice(0, 6).map((value) => ({
    type: "市场反馈",
    description: String(value || ""),
    source: latestUpdate.source || "",
    url: latestUpdate.url || "",
    date: dateOnly(latestUpdate.publishedAt || latestUpdate.published_at || ""),
    interpretation: "该反馈仅作为观察变量，需要结合后续价格、成交量或权威信息验证。",
    confidence: "中"
  }));
}

function structuredScenarios(event) {
  const watchSignals = (event.watchlist || event.watch_variables || []).slice(0, 3);
  return [
    {
      scenario_id: "scenario-a",
      name: "乐观情景",
      scenario: "乐观情景",
      condition: "后续出现更多权威来源、市场反馈或执行细节支持当前判断。",
      path: ["新证据出现", "当前判断被强化", "事件优先级继续保持"],
      possible_result: "事件成为需要持续跟踪的高优先级主线。",
      probability: "中",
      impact_level: event.importance_level || "中",
      confidence: "中",
      watch_signals: watchSignals
    },
    {
      scenario_id: "scenario-b",
      name: "中性情景",
      scenario: "中性情景",
      condition: "后续只有零散补充信息，缺少决定性证据。",
      path: ["信息继续更新", "缺少关键验证", "维持观察"],
      possible_result: "事件保留在观察列表，但不提高判断强度。",
      probability: "中",
      impact_level: "中",
      confidence: "中",
      watch_signals: watchSignals.slice(0, 2)
    },
    {
      scenario_id: "scenario-c",
      name: "反转情景",
      scenario: "反转情景",
      condition: "权威来源、市场反馈或后续执行结果否定当前判断。",
      path: ["反向证据出现", "原判断被削弱", "降低跟踪优先级"],
      possible_result: "当前事件可能只是短期噪声，需要重新评估。",
      probability: "低",
      impact_level: event.importance_level || "中",
      confidence: "低",
      watch_signals: watchSignals.slice(0, 2)
    }
  ];
}

function structuredRisks(risks = []) {
  return (risks || []).slice(0, 6).map((risk) => ({
    risk_type: "信息风险",
    risk,
    trigger: "后续证据与当前判断不一致，或关键来源无法交叉验证。",
    possible_consequence: "事件重要性可能被高估，跟踪优先级需要下调。",
    severity: "中",
    probability: "中",
    watch_signal: "观察是否出现权威澄清、市场反应或执行细节。"
  }));
}

function structuredCounterArguments(event) {
  return [{
    argument: "该事件可能被高估或误读。",
    reason: "当前信息可能只是短期报道集中，尚未证明会形成持续影响。",
    what_would_prove_it_wrong: "出现多来源验证、官方后续动作、市场持续反馈或企业实质行动。"
  }];
}

function structuredUncertainties(values = []) {
  return (values || []).slice(0, 6).map((uncertainty) => ({
    uncertainty,
    why_it_matters: "该不确定性会影响事件优先级和后续判断方向。",
    needed_evidence: "需要权威来源、后续报道、市场数据或执行反馈验证。"
  }));
}

function structuredWatchVariables(values = []) {
  return (values || []).slice(0, 6).map((variable) => ({
    variable,
    why_it_matters: "该变量会影响后续是否维持、提高或降低跟踪优先级。",
    signal_source: "官方公告 / 市场数据 / 财报 / 用户反馈 / 竞争对手动作 / 政策文件",
    update_frequency: "事件触发"
  }));
}

function structuredNextQuestions(values = [], event = {}) {
  const base = values.length ? values : [
    `${event.title || "该事件"}是否会形成持续影响？`,
    "后续是否有权威来源或市场反馈验证当前判断？"
  ];
  return base.slice(0, 5).map((question) => ({
    question,
    why_it_matters: "该问题决定事件是否值得继续提高跟踪优先级。",
    status: "待验证"
  }));
}

function buildDeepTracking(event, evidenceGaps = []) {
  const watchDashboard = structuredWatchVariables(event.watchlist || event.watch_variables || []);
  return {
    tracking_goal: `判断${event.title || "该事件"}是否会改变行业格局、市场预期、政策方向或个人决策。`,
    research_question: event.definition?.core_question || `这个事件后续真正需要回答的问题是什么？`,
    current_thesis: {
      thesis: event.current_judgment?.summary || event.decisionBrief || event.summary || "",
      confidence: event.confidence_level || "中",
      basis: (event.confirmedFacts || event.confirmed_facts_legacy || []).slice(0, 3),
      what_would_change_this_view: evidenceGaps.slice(0, 3)
    },
    core_tensions: [{
      tension: "短期信息热度与长期可验证影响之间的张力。",
      side_a: "现有高分来源提示事件值得跟踪。",
      side_b: "后续影响仍需要更多权威证据和市场反馈。",
      why_it_matters: "该张力决定是否需要把事件从观察升级为强跟踪主线。"
    }],
    key_assumptions: [{
      assumption: "当前高分条目和来源覆盖能代表该事件的主要变化。",
      risk_if_wrong: "如果来源覆盖偏窄，当前判断可能忽略更关键的反向信息。",
      evidence_needed: "需要更多权威来源、市场反馈或执行细节交叉验证。"
    }],
    causal_chain: [{
      step: 1,
      cause: "高分信息和多来源报道集中出现。",
      mechanism: "这些信息改变市场、行业、政策或用户对事件的预期。",
      effect: "事件进入重点跟踪列表，并设置后续观察变量。",
      confidence: event.confidence_level || "中"
    }],
    second_order_effects: [{
      effect: "如果事件持续发酵，可能影响市场预期、行业竞争或政策执行节奏。",
      logic_chain: ["信息集中出现", "影响外部预期", "进一步影响市场、行业、公司、政策或用户行为"],
      affected_areas: event.impactAreas || [],
      confidence: event.confidence_level || "中"
    }],
    scenario_tree: structuredScenarios(event),
    risk_paths: structuredRisks(event.riskFactors || []),
    contrarian_tracking: {
      main_counter_view: "该事件可能只是短期信息集中，而非持续主线。",
      counter_arguments: structuredCounterArguments(event),
      disconfirming_signals: evidenceGaps.slice(0, 3)
    },
    watch_dashboard: watchDashboard,
    judgment_history: [{
      date: dateOnly(event.updatedAt || event.last_seen_at || ""),
      judgment: event.current_judgment?.summary || event.decisionBrief || event.summary || "",
      change_type: "初始判断",
      reason: event.decisionBrief || "",
      evidence_item_ids: (event.items || []).map((item) => item.id).filter(Boolean).slice(0, 5)
    }],
    open_questions: structuredNextQuestions([], event),
    manual_review: {
      needed: (event.evidenceGaps || []).length > 0 || event.confidence_level !== "高",
      reason: "仍需要人工核对原文、来源质量和后续影响是否被高估。",
      review_focus: ["核对原文事实", "检查是否有反向证据", "观察后续权威发布或市场反馈"]
    }
  };
}

function buildDecisionBrief(lane, grade, items, eventMarketContext, policyStatus) {
  const label = decisionLaneLabel(lane);
  const top = items[0] || {};
  const tickers = eventMarketContext.tickers.length ? `\u5173\u8054 ${eventMarketContext.tickers.join("/")}` : "";
  const status = policyStatus ? `\u653f\u7b56\u72b6\u6001\uff1a${policyStatus}` : "";
  const suffix = [tickers, status].filter(Boolean).join("\uff1b");
  if (grade === "A") return compactSentence(`${label}\u51fa\u73b0\u9ad8\u4f18\u5148\u7ea7\u4fe1\u53f7\uff0c\u5efa\u8bae\u7acb\u5373\u6838\u5bf9\u539f\u6587\u3001\u884c\u60c5\u548c\u540e\u7eed\u5b98\u65b9\u53d1\u5e03${suffix ? `\uff1b${suffix}` : ""}\u3002`, 150);
  if (grade === "B") return compactSentence(`${label}\u503c\u5f97\u7eb3\u5165\u89c2\u5bdf\u5217\u8868\uff0c\u4f46\u9700\u7b49\u5f85\u66f4\u591a\u6765\u6e90\u6216\u5e02\u573a\u53cd\u5e94\u9a8c\u8bc1${suffix ? `\uff1b${suffix}` : ""}\u3002`, 150);
  return compactSentence(`${label}\u8bc1\u636e\u4e0d\u8db3\uff0c\u6682\u4e0d\u4f5c\u4e3a\u4ea4\u6613\u89c2\u5bdf\u4e3b\u7ebf\u3002${displaySummary(top)}`, 150);
}

function buildConfirmedFacts(items) {
  return uniqueValues(items.flatMap((item) => [
    ...(item.summary_points || []),
    displaySummary(item),
    displayTitle(item)
  ]), 4).map((fact) => compactSentence(fact, 120));
}

function buildMarketRelevance(lane, eventMarketContext, items) {
  if (lane !== "us_equities") {
    return lane === "china_us_ai"
      ? "\u5173\u6ce8\u7f8e\u80a1 AI \u94fe\u6761\u3001\u4e2d\u56fd AI \u653f\u7b56\u548c\u7b97\u529b\u4f9b\u7ed9\u7684\u8fde\u9501\u53cd\u5e94\u3002"
      : "\u5173\u6ce8\u653f\u7b56\u843d\u5730\u5bf9 A \u80a1\u3001\u6e2f\u80a1\u4e0e\u4e2d\u6982\u80a1\u9884\u671f\u7684\u5f71\u54cd\u3002";
  }
  if (!eventMarketContext.tickers.length) return "\u5c1a\u672a\u5339\u914d\u5230\u53ef\u8ddf\u8e2a\u7684\u7f8e\u80a1\u6216 ETF\u3002";
  const changes = eventMarketContext.tickers.map((symbol) => {
    const quote = eventMarketContext.symbols?.[symbol];
    if (!quote) return symbol;
    const pct = quote.changePercent || quote.change_percentage || "";
    return pct ? `${symbol} ${pct}` : symbol;
  });
  return `\u5173\u8054\u6807\u7684\uff1a${changes.join("\u3001")}\uff1b\u884c\u60c5\u65f6\u95f4\uff1a${eventMarketContext.generatedAt || "\u672a\u914d\u7f6e"}\u3002`;
}

function buildRiskFactors(items, eventMarketContext, sourceQuality) {
  const risks = uniqueValues(items.map((item) => item.risks).filter(Boolean), 3);
  if (eventMarketContext.stale) risks.push("\u884c\u60c5\u6570\u636e\u53ef\u80fd\u8fc7\u671f\uff0c\u9700\u6838\u5bf9\u5b9e\u65f6\u4ef7\u683c\u3002");
  if (sourceQuality.confidence === "low") risks.push("\u6765\u6e90\u9a8c\u8bc1\u4e0d\u8db3\uff0c\u4e0d\u5b9c\u5355\u72ec\u4f5c\u4e3a\u5224\u65ad\u4f9d\u636e\u3002");
  return risks.length ? risks.slice(0, 4) : ["\u540e\u7eed\u6267\u884c\u7ec6\u8282\u548c\u5e02\u573a\u53cd\u5e94\u4ecd\u9700\u7ee7\u7eed\u8ddf\u8e2a\u3002"];
}

function buildEvidenceGaps(lane, eventMarketContext, sourceQuality) {
  const gaps = [];
  if (lane === "us_equities" && !eventMarketContext.hasMarketData) gaps.push("\u7f3a\u5c11\u53ef\u7528\u884c\u60c5\u6570\u636e\u6216 API \u5bc6\u94a5\u3002");
  if (sourceQuality.sourceCount < 2) gaps.push("\u7f3a\u5c11\u8de8\u6765\u6e90\u4ea4\u53c9\u9a8c\u8bc1\u3002");
  if (sourceQuality.officialCount < 1) gaps.push("\u7f3a\u5c11\u5b98\u65b9\u6216\u5e02\u573a\u6743\u5a01\u6765\u6e90\u3002");
  if (!gaps.length) gaps.push("\u7ee7\u7eed\u89c2\u5bdf\u540e\u7eed\u5b98\u65b9\u53d1\u5e03\u548c\u4ef7\u683c\u53cd\u5e94\u662f\u5426\u4e00\u81f4\u3002");
  return gaps.slice(0, 4);
}

function significantKeywords(item) {
  const generic = new Set([
    "tech",
    "finance",
    "business",
    "macro",
    "international",
    "news",
    "daily",
    "media",
    "official-agency",
    "official-market",
    "official-media",
    "financial-media",
    "realtime",
    "hourly",
    "periodic",
    "ai",
    "公共政策",
    "宏观",
    "国际",
    "金融",
    "科技",
    "新闻",
    "商业",
    "监管",
    "市场",
    "官方机构",
    "官方市场",
    "官方媒体",
    "中文财经源",
    "小时级",
    "日更",
    "实时",
    "定期"
  ]);
  return itemKeywords(item)
    .map((keyword) => keyword.toLowerCase())
    .filter((keyword) => keyword.length >= 2 && !generic.has(keyword))
    .slice(0, 6);
}

function sharedKeywordCount(left, right) {
  const rightKeywords = new Set(significantKeywords(right));
  return significantKeywords(left).filter((keyword) => rightKeywords.has(keyword)).length;
}

function eventLabelForItem(item, rule) {
  const keyword = significantKeywords(item)[0];
  const originalKeyword = itemKeywords(item).find((value) => String(value).toLowerCase() === keyword && hasChineseText(value));
  return originalKeyword || rule?.label || compactSentence(displayTitle(item), 32);
}

function sourceAuthorityLabel(value) {
  return {
    "official-agency": "官方机构",
    "official-market": "官方市场",
    "official-media": "官方媒体",
    media: "媒体"
  }[value] || "公开来源";
}

function buildImpactAreas(items, fallbackLabel) {
  const values = uniqueValues(items.flatMap((item) => [
    ...(item.impactAreas || []),
    ...itemKeywords(item),
    item.primaryCategory,
    item.category
  ]).filter(hasChineseText), 8);
  return (values.length ? values : [fallbackLabel]).slice(0, 4);
}

function buildExplainedSummary(items, label) {
  return buildEventSummary(items, label);
}

function buildWhyItMatters(items, label) {
  const top = items[0] || {};
  const existing = top.importance || top.summaryReason;
  if (hasChineseText(existing)) return existing;
  const officialCount = items.filter((item) => ["official-agency", "official-market", "official-media"].includes(item.sourceAuthority)).length;
  const sourceCount = uniqueValues(items.map((item) => item.source), 6).length;
  const newestAt = top.publishedAt ? new Date(top.publishedAt).getTime() : 0;
  const freshText = newestAt && Date.now() - newestAt < 36 * 60 * 60 * 1000 ? "仍处在高时效窗口内" : "适合作为后续观察线索";
  const authorityText = officialCount > 0 ? `包含 ${officialCount} 条官方或市场权威来源` : `覆盖 ${sourceCount} 个公开来源`;
  return compactSentence(`${label} 会影响政策、市场、产业或国际变化判断；${authorityText}，${freshText}。`, 120);
}

function buildWatchlist(items, label) {
  const areas = buildImpactAreas(items, label).slice(0, 3);
  const sources = uniqueValues(items.map((item) => item.source), 2);
  return [
    areas.length ? `跟踪 ${areas.join("、")} 的后续变化` : `跟踪 ${label} 的后续更新`,
    sources.length ? `留意 ${sources.join("、")} 是否继续发布相关信息` : "",
    "观察是否出现监管、市场价格、企业动作或国际反应"
  ].filter(Boolean).slice(0, 3);
}

function buildEvidenceItems(items) {
  return items.map((item) => ({
    id: item.id,
    title: displayTitle(item),
    summary: displaySummary(item),
    url: item.url,
    source: item.source,
    sourceAuthority: item.sourceAuthority,
    sourceAuthorityLabel: sourceAuthorityLabel(item.sourceAuthority),
    category: item.category,
    publishedAt: item.publishedAt,
    score: item.score
  }));
}

function evidenceTypeForItem(item) {
  if (["official-agency", "official-market", "official-media"].includes(item.sourceAuthority)) return "official_announcement";
  if (item.sourceAuthority === "financial-media") return "reliable_media_report";
  if (item.category === "finance" || item.category === "macro") return "data_release";
  if (item.category === "business") return "industry_analysis";
  if (item.category === "tech") return "industry_analysis";
  return "unknown";
}

function levelFromScore(score, itemCount = 0) {
  if (Number(score || 0) >= 90 || Number(itemCount || 0) >= 8) return "\u9ad8";
  if (Number(score || 0) >= 75 || Number(itemCount || 0) >= 4) return "\u4e2d";
  return "\u4f4e";
}

function confidenceLevel(sourceQuality = {}) {
  return {
    high: "\u9ad8",
    medium: "\u4e2d",
    low: "\u4f4e"
  }[sourceQuality.confidence] || "\u4e2d";
}

function currentStatusForGrade(grade) {
  if (grade === "A") return "\u6301\u7eed\u8ddf\u8e2a";
  if (grade === "B") return "\u7b49\u5f85\u65b0\u8fdb\u5c55";
  return "\u4fe1\u606f\u4e0d\u8db3";
}

function dateOnly(value, fallback = "") {
  const text = String(value || fallback || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function buildLatestChange(latestUpdate = {}) {
  const title = normalizeText(latestUpdate.title);
  const summary = normalizeText(latestUpdate.summary);
  if (!title && !summary) return "\u6682\u65e0\u6700\u65b0\u53d8\u5316\uff0c\u8bf7\u6839\u636e\u540e\u7eed\u6293\u53d6\u5185\u5bb9\u66f4\u65b0\u3002";
  return compactSentence([title, summary].filter(Boolean).join("\uff1a"), 180);
}

function buildEventCategories(impactAreas = [], laneLabel = "") {
  return uniqueValues([laneLabel, ...impactAreas].filter(Boolean), 6);
}

function buildImpactAnalysis(lane, eventMarketContext, items, label) {
  const market = buildMarketRelevance(lane, eventMarketContext, items);
  const related = extractRelatedEntities(items, eventMarketContext.tickers).slice(0, 6);
  const areas = buildImpactAreas(items, label).join("\u3001");
  return {
    market,
    industry: areas
      ? `\u53ef\u80fd\u5f71\u54cd ${areas} \u76f8\u5173\u5224\u65ad\uff0c\u9700\u7ee7\u7eed\u6838\u5bf9\u540e\u7eed\u8bc1\u636e\u3002`
      : "\u76ee\u524d\u8bc1\u636e\u4e0d\u8db3\uff0c\u6682\u4e0d\u4f5c\u884c\u4e1a\u5c42\u9762\u5f3a\u5224\u65ad\u3002",
    company: related.length
      ? `\u5173\u8054\u5b9e\u4f53\uff1a${related.join("\u3001")}\u3002`
      : "\u76ee\u524d\u672a\u5339\u914d\u5230\u660e\u786e\u516c\u53f8\u5c42\u9762\u5f71\u54cd\u3002",
    user: "\u5bf9\u666e\u901a\u7528\u6237\u6216\u5f00\u53d1\u8005\u7684\u76f4\u63a5\u5f71\u54cd\u5c1a\u9700\u6839\u636e\u540e\u7eed\u4ea7\u54c1\u3001\u653f\u7b56\u6216\u5e02\u573a\u53cd\u5e94\u5224\u65ad\u3002"
  };
}

function buildMarketFeedback(eventMarketContext = {}) {
  const symbolRows = Object.entries(eventMarketContext.symbols || {})
    .map(([symbol, quote]) => `${symbol} ${quote.changePercent || quote.change_percentage || quote.change || ""}`.trim())
    .filter(Boolean);
  const movers = (eventMarketContext.topMovers || [])
    .map((entry) => `${entry.symbol || ""} ${entry.changePercent || entry.change_percentage || ""}`.trim())
    .filter(Boolean);
  return uniqueValues([...symbolRows, ...movers], 6);
}

function buildRelatedArticles(evidenceItems) {
  return (evidenceItems || []).map((item) => ({
    item_id: item.id || "",
    title: item.title || "",
    source: item.source || "",
    url: item.url || "",
    published_at: item.publishedAt || "",
    summary: item.summary || "",
    relevance_score: Number(item.score || 0)
  }));
}

function buildEventQuality(event = {}) {
  const checks = {
    has_definition: Boolean(event.definition?.one_sentence),
    has_current_judgment: Boolean(event.current_judgment?.summary),
    has_deep_tracking: Boolean(event.deep_tracking),
    has_core_tensions: Boolean(event.deep_tracking?.core_tensions?.length),
    has_key_assumptions: Boolean(event.deep_tracking?.key_assumptions?.length),
    has_second_order_effects: Boolean(event.deep_tracking?.second_order_effects?.length),
    has_scenario_tree: Boolean(event.deep_tracking?.scenario_tree?.length),
    has_risk_paths: Boolean(event.deep_tracking?.risk_paths?.length),
    has_contrarian_tracking: Boolean(event.deep_tracking?.contrarian_tracking),
    has_watch_dashboard: Boolean(event.deep_tracking?.watch_dashboard?.length),
    has_judgment_history: Boolean(event.deep_tracking?.judgment_history?.length),
    has_timeline: Boolean(event.timeline?.length),
    has_confirmed_facts: Boolean(event.confirmed_facts?.length),
    has_impact: Boolean(event.impact),
    has_risks: Boolean(event.risks?.length),
    has_forward_scenarios: Boolean(event.forward_scenarios?.length),
    has_counter_arguments: Boolean(event.counter_arguments?.length),
    has_watch_variables: Boolean(event.watch_variables?.length),
    has_next_questions: Boolean(event.next_questions?.length),
    has_source_links: Boolean(event.evidence?.source_links?.length)
  };
  const passed = Object.values(checks).filter(Boolean).length;
  return {
    score: Math.round((passed / Object.keys(checks).length) * 100),
    flags: Object.entries(checks).filter(([, value]) => !value).map(([key]) => key),
    checks
  };
}

function enrichTimelineItem(item) {
  return {
    ...item,
    description: item.description || item.summary || "",
    evidence_type: item.evidence_type || item.evidenceType || "unknown",
    importance: item.importance || levelFromScore(item.score, 1),
    sources: item.sources || [{
      title: item.title || "",
      source: item.source || "",
      url: item.url || "",
      published_at: item.publishedAt || item.date || ""
    }]
  };
}

function latestUpdateItem(items) {
  const latest = [...items]
    .filter((item) => item.publishedAt)
    .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime())[0]
    || items[0]
    || {};
  return {
    title: displayTitle(latest),
    summary: compactSentence(displaySummary(latest), 120),
    source: latest.source,
    url: latest.url,
    publishedAt: latest.publishedAt,
    published_at: latest.publishedAt,
    score: Number(latest.score || 0)
  };
}

function timelineItem(item) {
  return {
    date: String(item.publishedAt || "").slice(0, 10),
    title: displayTitle(item),
    summary: compactSentence(displaySummary(item), 140),
    description: compactSentence(displaySummary(item), 140),
    evidence_type: evidenceTypeForItem(item),
    importance: levelFromScore(Number(item.score || 0), 1),
    does_it_change_judgment: Number(item.score || 0) >= 85,
    impact: item.importance || item.why_it_matters || item.summaryReason || compactSentence(displaySummary(item), 140),
    sources: [{
      title: displayTitle(item),
      source: item.source || "",
      url: item.url || "",
      published_at: item.publishedAt || ""
    }],
    source: item.source,
    url: item.url,
    score: Number(item.score || 0),
    publishedAt: item.publishedAt
  };
}

function buildTimeline(items) {
  const seen = new Set();
  return [...items]
    .sort((left, right) => new Date(left.publishedAt || 0).getTime() - new Date(right.publishedAt || 0).getTime())
    .map(timelineItem)
    .filter((item) => {
      const key = `${item.date}|${item.title}|${item.source}`;
      if (!item.date || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-12);
}

function heatLabel(score, itemCount) {
  if (score >= 92 || itemCount >= 8) return "高";
  if (score >= 80 || itemCount >= 4) return "中";
  return "低";
}

function keywordSignature(item) {
  return significantKeywords(item).slice(0, 3).join("|");
}

function fallbackRuleForItem(item) {
  const signature = keywordSignature(item);
  if (!signature) return null;
  return {
    id: `topic-${slugify(signature)}`,
    label: itemKeywords(item)[0] || displayTitle(item)
  };
}

function groupForItem(item, groups) {
  const forcedLane = forcedDecisionLaneForItem(item);
  if (forcedLane) {
    const id = `lane-${forcedLane}`;
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        label: decisionLaneLabel(forcedLane),
        forcedLane,
        items: []
      });
    }
    return groups.get(id);
  }

  const rule = ruleForItem(item) || fallbackRuleForItem(item);
  if (!rule) return null;

  const similar = [...groups.values()].find((group) => {
    if (group.forcedLane && !isCompatibleWithForcedLane(item, group.forcedLane)) return false;
    const representative = group.items[0];
    const sharedKeywords = sharedKeywordCount(item, representative);
    const hasSpecificSharedKeyword = significantKeywords(item).some((keyword) => significantKeywords(representative).includes(keyword) && keyword.length >= 4);
    const similarity = titleSimilarity(displayTitle(item), displayTitle(representative));
    return sharedKeywords >= 2 || hasSpecificSharedKeyword || (sharedKeywords >= 1 && similarity >= 0.42) || similarity >= 0.58;
  });
  if (similar) return similar;

  const signature = keywordSignature(item) || slugify(displayTitle(item));
  const id = `${rule.id}-${slugify(signature || displayTitle(item))}`;
  const group = { id, label: eventLabelForItem(item, rule), items: [] };
  groups.set(id, group);
  return group;
}

function dedupeEventItems(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = item.id || item.url || `${displayTitle(item)}|${item.publishedAt}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cutoffTime(generatedAt, lookbackDays) {
  const base = new Date(generatedAt);
  const now = Number.isNaN(base.getTime()) ? new Date() : base;
  return now.getTime() - Number(lookbackDays || EVENT_LOOKBACK_DAYS) * 24 * 60 * 60 * 1000;
}

function readArchiveItems(generatedAt, options = {}) {
  const archiveDir = options.archiveDir || ARCHIVE_DIR;
  const lookbackDays = Number(options.lookbackDays || EVENT_LOOKBACK_DAYS);
  if (!fs.existsSync(archiveDir)) return [];
  const minTime = cutoffTime(generatedAt, lookbackDays);
  return fs.readdirSync(archiveDir)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      const archive = readJson(path.join(archiveDir, file), { items: [] });
      const archiveTime = new Date(archive.generatedAt || archive.date || file.replace(/\.json$/, "")).getTime();
      if (!Number.isNaN(archiveTime) && archiveTime < minTime) return [];
      return (archive.items || []).map((item) => ({ ...item, archiveDate: archive.date || file.replace(/\.json$/, "") }));
    });
}

function buildEvents(items, generatedAt = new Date().toISOString(), options = {}) {
  const groups = new Map();
  const marketContext = options.marketContext || {};

  dedupeEventItems(items || []).filter(isEventReadyItem).forEach((item) => {
    const group = groupForItem(item, groups);
    if (!group) return;
    group.items.push(item);
  });

  const events = [...groups.values()]
    .map((group) => {
      const maxEventItems = Number(options.maxEventItems || 20);
      let sortedItems = group.items
        .sort((left, right) => Number(right.score || 0) - Number(left.score || 0)
          || new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime())
        .slice(0, group.forcedLane ? maxEventItems : group.items.length);
      let eventMarketContext = buildEventMarketContext(sortedItems, marketContext);
      let decisionLane = group.forcedLane || eventDecisionLane(sortedItems, eventMarketContext);
      const focusedItems = focusItemsForDecisionLane(sortedItems, decisionLane);
      if (focusedItems.length >= 2 && focusedItems.length < sortedItems.length) {
        sortedItems = focusedItems.slice(0, maxEventItems);
        eventMarketContext = buildEventMarketContext(sortedItems, marketContext);
        decisionLane = group.forcedLane || eventDecisionLane(sortedItems, eventMarketContext);
      }
      const topItems = sortedItems.slice(0, 6);
      const evidenceItems = buildEvidenceItems(topItems);
      const timeline = buildTimeline(sortedItems);
      const keyDevelopments = timeline.slice(-4);
      const latestUpdate = latestUpdateItem(sortedItems);
      const updatedAt = sortedItems
        .map((item) => item.publishedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || generatedAt;
      const sourceQuality = buildSourceQuality(sortedItems, timeline, eventMarketContext);
      const grade = decisionGrade(decisionLane, sourceQuality, eventMarketContext, Number(topItems[0]?.score || 0));
      const policyStatus = buildPolicyStatus(sortedItems, decisionLane);
      const topScore = Number(topItems[0]?.score || 0);
      const laneLabel = decisionLaneLabel(decisionLane);
      const impactAreas = buildImpactAreas(topItems, group.label);
      const watchlist = buildWatchlist(topItems, group.label);
      const riskFactors = buildRiskFactors(topItems, eventMarketContext, sourceQuality);
      const evidenceGaps = buildEvidenceGaps(decisionLane, eventMarketContext, sourceQuality);
      const relatedEntities = extractRelatedEntities(sortedItems, eventMarketContext.tickers);
      const whyItMatters = buildWhyItMatters(topItems, group.label);
      const enrichedTimeline = timeline.map(enrichTimelineItem);
      const confirmedFactTexts = buildConfirmedFacts(topItems);
      const summary = buildExplainedSummary(topItems, group.label);
      const oneSentenceSummary = buildExplainedSummary(topItems, group.label);
      const decisionBrief = buildDecisionBrief(decisionLane, grade, topItems, eventMarketContext, policyStatus);
      const latestChange = buildLatestChange(latestUpdate);
      const impactAnalysis = buildImpactAnalysis(decisionLane, eventMarketContext, topItems, group.label);
      const relatedArticles = buildRelatedArticles(evidenceItems);
      const evidenceSummary = relatedArticles.map((item) => item.summary || item.title).filter(Boolean).slice(0, 3);
      const status = currentStatusForGrade(grade);
      const firstSeen = firstSeenAt(sortedItems, generatedAt);
      const legacyEvent = {
        id: group.id,
        event_id: group.id,
        title: group.label,
        summary,
        one_sentence_summary: oneSentenceSummary,
        decisionLane,
        decisionLaneLabel: laneLabel,
        decisionGrade: grade,
        decisionSignal: decisionSignal(grade),
        decisionBrief,
        current_status: status,
        category: buildEventCategories(impactAreas, laneLabel),
        importance_level: levelFromScore(topScore, sortedItems.length),
        confidence_level: confidenceLevel(sourceQuality),
        last_updated: dateOnly(updatedAt, generatedAt),
        latest_change: latestChange,
        marketContext: eventMarketContext,
        policyStatus,
        confirmedFacts: confirmedFactTexts,
        confirmed_facts_legacy: confirmedFactTexts,
        marketRelevance: buildMarketRelevance(decisionLane, eventMarketContext, topItems),
        riskFactors,
        evidenceGaps,
        sourceQuality,
        relatedEntities,
        whyItMatters,
        impactAreas,
        impact_analysis: impactAnalysis,
        market_feedback: buildMarketFeedback(eventMarketContext),
        uncertainties: uniqueValues([...riskFactors, ...evidenceGaps], 8),
        watchlist,
        watch_variables: watchlist,
        updatedAt,
        latestUpdate,
        keyDevelopments,
        itemCount: sortedItems.length,
        heat: heatLabel(topScore, sortedItems.length),
        primarySource: latestUpdate.source || topItems[0]?.source || "",
        sourceCount: uniqueValues(sortedItems.map((item) => item.source), 20).length,
        sources: [...new Set(sortedItems.map((item) => item.source).filter(Boolean))].slice(0, 6),
        keywords: [...new Set(sortedItems.flatMap((item) => [...(item.impactAreas || []), ...itemKeywords(item)]).filter(hasChineseText))].slice(0, 8),
        timeline: enrichedTimeline,
        evidenceItems,
        related_articles: relatedArticles,
        my_questions: [],
        analysis_notes: [],
        items: evidenceItems
      };
      const confidence = confidenceLevel(sourceQuality);
      const event = {
        ...legacyEvent,
        lane_id: decisionLane,
        lane_label: laneLabel,
        status: status === "持续跟踪" ? "active" : "watching",
        priority_grade: priorityGradeValue(grade),
        importance_score: topScore,
        first_seen_at: firstSeen,
        last_seen_at: updatedAt,
        updated_at: updatedAt,
        definition: {
          one_sentence: oneSentenceSummary,
          background: summary,
          core_question: `${group.label}后续是否会形成持续影响，并改变市场、行业、政策或用户判断？`,
          why_it_matters: whyItMatters,
          scope: `追踪${laneLabel}相关的权威来源、市场反馈、执行进展和反向证据；不追踪无来源支撑的短期噪声。`
        },
        decision: {
          signal: decisionSignal(grade),
          brief: decisionBrief,
          rationale: [
            `属于${laneLabel}主线`,
            `重要性评分为 ${topScore}`,
            `证据置信度为${confidence}`
          ],
          market_symbols: eventMarketContext.tickers || [],
          policy_status: policyStatus || "",
          requires_follow_up: grade !== "C"
        },
        profile: {
          impact_areas: impactAreas,
          entities: {
            companies: relatedEntities.filter((entity) => US_EQUITY_SYMBOLS.includes(entity) || hasAnyText(entity, ["OpenAI", "NVIDIA", "Microsoft", "Google", "Meta", "Amazon", "Tesla"])),
            people: relatedEntities.filter((entity) => hasAnyText(entity, ["Musk", "马斯克"])),
            institutions: relatedEntities.filter((entity) => hasAnyText(entity, [...CHINA_POLICY_SOURCES, "SEC", "Federal Reserve", "NASA", "FAA", "FCC"])),
            countries_or_regions: [],
            products_or_technologies: relatedEntities.filter((entity) => hasAnyText(entity, AI_ENTITY_ALIASES))
          },
          related_item_count: sortedItems.length
        },
        current_judgment: {
          summary: decisionBrief || summary,
          basis: confirmedFactTexts.slice(0, 4),
          latest_change: latestChange,
          judgment_update: "初始判断",
          confidence_reason: sourceQuality.confidence === "high"
            ? "包含权威来源或多来源验证，当前判断置信度较高。"
            : "来源覆盖或后续证据仍有限，当前判断需要继续验证。"
        },
        evidence: {
          source_count: sourceQuality.sourceCount,
          official_source_count: sourceQuality.officialCount,
          financial_media_count: sourceQuality.financialMediaCount,
          timeline_count: enrichedTimeline.length,
          confidence_basis: confidenceBasis(sourceQuality),
          evidence_types: evidenceTypeCounts(topItems),
          primary_source: {
            name: latestUpdate.source || topItems[0]?.source || "",
            url: latestUpdate.url || topItems[0]?.url || ""
          },
          source_links: relatedArticles,
          evidence_gaps: evidenceGaps
        },
        latest_update: {
          title: latestUpdate.title || "",
          summary: latestUpdate.summary || "",
          source: latestUpdate.source || "",
          url: latestUpdate.url || "",
          published_at: latestUpdate.publishedAt || latestUpdate.published_at || "",
          score: Number(latestUpdate.score || 0)
        },
        confirmed_facts: factObjects(confirmedFactTexts, evidenceItems, confidence),
        impact: structuredImpact(impactAnalysis, evidenceSummary, confidence),
        market_feedback: structuredMarketFeedback(buildMarketFeedback(eventMarketContext), latestUpdate),
        forward_scenarios: structuredScenarios(legacyEvent),
        risks: structuredRisks(riskFactors),
        counter_arguments: structuredCounterArguments(legacyEvent),
        uncertainties: structuredUncertainties(uniqueValues([...riskFactors, ...evidenceGaps], 8)),
        watch_variables: structuredWatchVariables(watchlist),
        next_questions: structuredNextQuestions([], legacyEvent),
        related_items: relatedArticles
      };
      event.deep_tracking = buildDeepTracking(event, evidenceGaps);
      event.quality = buildEventQuality(event);
      return event;
    })
    .filter((event) => event.itemCount >= 2
      && event.timeline.length >= 2
      && event.itemCount <= Number(options.maxEventItems || 20)
      && event.decisionLane
      && event.decisionGrade !== "C")
    .sort((left, right) => ["A", "B", "C"].indexOf(left.decisionGrade) - ["A", "B", "C"].indexOf(right.decisionGrade)
      || Number(right.items[0]?.score || 0) - Number(left.items[0]?.score || 0)
      || new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime())
    .slice(0, Number(options.limit || 8));

  return {
    schema_version: EVENT_TRACKING_SCHEMA_VERSION,
    generated_at: generatedAt,
    meta: {
      lookback_days: Number(options.lookbackDays || EVENT_LOOKBACK_DAYS),
      event_count: events.length,
      market_context: {
        status: marketContext.status || "missing",
        generated_at: marketContext.generatedAt || ""
      },
      llm: {
        enabled: Boolean(options.llmProduction?.enabled),
        provider: options.llmProduction?.provider || "",
        method: options.llmProduction?.provider?.includes("chat") ? "chat-completions" : (options.llmProduction?.provider || ""),
        model: options.llmProduction?.model || ""
      },
      stats: {
        fallback_count: 0,
        error_count: 0
      }
    },
    decision_lanes: DECISION_LANES,
    generatedAt,
    lookbackDays: Number(options.lookbackDays || EVENT_LOOKBACK_DAYS),
    decisionLanes: {
      us_equities: decisionLaneLabel("us_equities"),
      china_us_ai: decisionLaneLabel("china_us_ai"),
      china_policy: decisionLaneLabel("china_policy")
    },
    marketContextStatus: marketContext.status || "missing",
    marketContextGeneratedAt: marketContext.generatedAt || "",
    totalEvents: events.length,
    events
  };
}

function eventItemKeys(item) {
  return [item.id, item.url].map(normalizeText).filter(Boolean);
}

function buildTimelineEventMap(events) {
  const map = new Map();
  (events || []).forEach((event) => {
    [
      event.latestUpdate,
      ...(event.keyDevelopments || []),
      ...(event.timeline || []),
      ...(event.evidenceItems || []),
      ...(event.items || [])
    ].filter(Boolean).forEach((item) => {
      eventItemKeys(item).forEach((key) => {
        if (!map.has(key)) map.set(key, event.id);
      });
    });
  });
  return map;
}

function applyTimelineEventIds(latest, events) {
  const eventMap = buildTimelineEventMap(events);
  const items = (latest.items || []).map((item) => {
    const eventId = eventItemKeys(item).map((key) => eventMap.get(key)).find(Boolean);
    return eventId ? { ...item, timeline_event_id: eventId } : item;
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  const channels = Object.fromEntries(Object.entries(latest.channels || {}).map(([id, channel]) => [
    id,
    {
      ...channel,
      items: (channel.items || []).map((item) => byId.get(item.id) || item)
    }
  ]));
  return { ...latest, items, channels };
}

function generateEvents(options = {}) {
  const latest = readJson(LATEST_PATH, { items: [], generatedAt: "" });
  const generatedAt = latest.generatedAt || new Date().toISOString();
  const archiveItems = readArchiveItems(generatedAt, options);
  const marketContext = options.marketContext || readJson(MARKET_CONTEXT_PATH, { status: "missing", symbols: {}, topMovers: [] });
  const rules = options.rules || readJson(path.join(ROOT_DIR, "config", "ai-summary-rules.json"), {});
  const data = buildEvents([...(archiveItems || []), ...(latest.items || [])], generatedAt, {
    ...options,
    marketContext,
    llmProduction: options.llmProduction || rules.llmProduction || {}
  });
  fs.mkdirSync(path.dirname(EVENTS_PATH), { recursive: true });
  fs.writeFileSync(EVENTS_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.writeFileSync(LATEST_PATH, `${JSON.stringify(applyTimelineEventIds(latest, data.events), null, 2)}\n`, "utf8");
  return data;
}

if (require.main === module) {
  const data = generateEvents();
  console.log(`Generated ${data.meta?.event_count || data.totalEvents || 0} event clusters.`);
}

module.exports = {
  buildEvents,
  buildTimeline,
  buildEventMarketContext,
  eventDecisionLane,
  applyTimelineEventIds,
  buildTimelineEventMap,
  generateEvents,
  readArchiveItems
};
