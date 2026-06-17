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
  return {
    us_equities: "\u7f8e\u80a1\u53d8\u5316",
    china_us_ai: "\u4e2d\u7f8e AI \u53d1\u5c55",
    china_policy: "\u4e2d\u56fd\u6743\u5a01\u653f\u7b56\u843d\u5730"
  }[lane] || "\u91cd\u70b9\u4e8b\u4ef6";
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
    score: Number(latest.score || 0)
  };
}

function timelineItem(item) {
  return {
    date: String(item.publishedAt || "").slice(0, 10),
    title: displayTitle(item),
    summary: compactSentence(displaySummary(item), 140),
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
      return {
        id: group.id,
        title: group.label,
        summary: buildExplainedSummary(topItems, group.label),
        decisionLane,
        decisionLaneLabel: decisionLaneLabel(decisionLane),
        decisionGrade: grade,
        decisionSignal: decisionSignal(grade),
        decisionBrief: buildDecisionBrief(decisionLane, grade, topItems, eventMarketContext, policyStatus),
        marketContext: eventMarketContext,
        policyStatus,
        confirmedFacts: buildConfirmedFacts(topItems),
        marketRelevance: buildMarketRelevance(decisionLane, eventMarketContext, topItems),
        riskFactors: buildRiskFactors(topItems, eventMarketContext, sourceQuality),
        evidenceGaps: buildEvidenceGaps(decisionLane, eventMarketContext, sourceQuality),
        sourceQuality,
        relatedEntities: extractRelatedEntities(sortedItems, eventMarketContext.tickers),
        whyItMatters: buildWhyItMatters(topItems, group.label),
        impactAreas: buildImpactAreas(topItems, group.label),
        watchlist: buildWatchlist(topItems, group.label),
        updatedAt,
        latestUpdate,
        keyDevelopments,
        itemCount: sortedItems.length,
        heat: heatLabel(Number(topItems[0]?.score || 0), sortedItems.length),
        primarySource: latestUpdate.source || topItems[0]?.source || "",
        sourceCount: uniqueValues(sortedItems.map((item) => item.source), 20).length,
        sources: [...new Set(sortedItems.map((item) => item.source).filter(Boolean))].slice(0, 6),
        keywords: [...new Set(sortedItems.flatMap((item) => [...(item.impactAreas || []), ...itemKeywords(item)]).filter(hasChineseText))].slice(0, 8),
        timeline,
        evidenceItems,
        items: evidenceItems
      };
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
    generatedAt,
    lookbackDays: Number(options.lookbackDays || EVENT_LOOKBACK_DAYS),
    decisionLanes: {
      us_equities: "\u7f8e\u80a1\u53d8\u5316",
      china_us_ai: "\u4e2d\u7f8e AI \u53d1\u5c55",
      china_policy: "\u4e2d\u56fd\u6743\u5a01\u653f\u7b56\u843d\u5730"
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
  const data = buildEvents([...(archiveItems || []), ...(latest.items || [])], generatedAt, { ...options, marketContext });
  fs.mkdirSync(path.dirname(EVENTS_PATH), { recursive: true });
  fs.writeFileSync(EVENTS_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.writeFileSync(LATEST_PATH, `${JSON.stringify(applyTimelineEventIds(latest, data.events), null, 2)}\n`, "utf8");
  return data;
}

if (require.main === module) {
  const data = generateEvents();
  console.log(`Generated ${data.totalEvents} event clusters.`);
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
