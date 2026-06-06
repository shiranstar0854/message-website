const fs = require("node:fs");
const path = require("node:path");
const { readJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");
const LATEST_PATH = path.join(ROOT_DIR, "src", "data", "latest-items.json");
const EVENTS_PATH = path.join(ROOT_DIR, "src", "data", "events.json");

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

function itemText(item) {
  return normalizeText([
    item.titleZh,
    item.translatedTitle,
    item.title,
    item.summaryZh,
    item.aiSummary,
    item.summary,
    item.contentExcerpt,
    item.category,
    item.primaryCategory,
    ...(item.impactAreas || []),
    ...(item.keywords || []),
    ...(item.tags || [])
  ].filter(Boolean).join(" "));
}

function ruleForItem(item) {
  const text = itemText(item);
  return EVENT_RULES.find((rule) => rule.pattern.test(text));
}

function displayTitle(item) {
  return item.titleZh || item.translatedTitle || item.title || "未命名信息";
}

function displaySummary(item) {
  return item.summaryZh || item.aiSummary || item.contentExcerpt || item.summary || "";
}

function buildEventSummary(items) {
  const top = items[0];
  const sources = [...new Set(items.map((item) => item.source).filter(Boolean))].slice(0, 3);
  return [
    displaySummary(top),
    sources.length ? `相关来源：${sources.join("、")}` : ""
  ].filter(Boolean).join(" ");
}

function uniqueValues(values, limit) {
  return [...new Set(values.map(normalizeText).filter(Boolean))].slice(0, limit);
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
    ...(item.keywords || []),
    item.primaryCategory,
    item.category
  ]), 8);
  return (values.length ? values : [fallbackLabel]).slice(0, 4);
}

function buildExplainedSummary(items, label) {
  const top = items[0] || {};
  const sources = uniqueValues(items.map((item) => item.source), 3);
  return [
    displaySummary(top) || `${label} 相关信息正在形成聚合。`,
    sources.length ? `相关来源：${sources.join("、")}` : ""
  ].filter(Boolean).join(" ");
}

function buildWhyItMatters(items, label) {
  const top = items[0] || {};
  if (top.importance || top.summaryReason) return top.importance || top.summaryReason;
  const officialCount = items.filter((item) => ["official-agency", "official-market", "official-media"].includes(item.sourceAuthority)).length;
  const sourceCount = uniqueValues(items.map((item) => item.source), 6).length;
  const newestAt = top.publishedAt ? new Date(top.publishedAt).getTime() : 0;
  const freshText = newestAt && Date.now() - newestAt < 36 * 60 * 60 * 1000 ? "仍处在高时效窗口内" : "适合作为后续观察线索";
  const authorityText = officialCount > 0 ? `包含 ${officialCount} 条官方或市场权威来源` : `覆盖 ${sourceCount} 个公开来源`;
  return `${label} 会影响用户对政策、市场、产业或国际变化的判断；${authorityText}，${freshText}。`;
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

function buildEvents(items, generatedAt = new Date().toISOString()) {
  const groups = new Map();

  (items || []).forEach((item) => {
    const rule = ruleForItem(item);
    if (!rule) return;
    if (!groups.has(rule.id)) {
      groups.set(rule.id, { id: rule.id, label: rule.label, items: [] });
    }
    groups.get(rule.id).items.push(item);
  });

  const events = [...groups.values()]
    .map((group) => {
      const sortedItems = group.items
        .sort((left, right) => Number(right.score || 0) - Number(left.score || 0)
          || new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime());
      const topItems = sortedItems.slice(0, 6);
      const evidenceItems = buildEvidenceItems(topItems);
      return {
        id: group.id,
        title: group.label,
        summary: buildExplainedSummary(topItems, group.label),
        whyItMatters: buildWhyItMatters(topItems, group.label),
        impactAreas: buildImpactAreas(topItems, group.label),
        watchlist: buildWatchlist(topItems, group.label),
        updatedAt: topItems[0]?.publishedAt || generatedAt,
        itemCount: sortedItems.length,
        sources: [...new Set(sortedItems.map((item) => item.source).filter(Boolean))].slice(0, 6),
        keywords: [...new Set(sortedItems.flatMap((item) => [...(item.impactAreas || []), ...(item.keywords || [])]))].slice(0, 8),
        evidenceItems,
        items: evidenceItems
      };
    })
    .filter((event) => event.itemCount >= 2)
    .sort((left, right) => Number(right.items[0]?.score || 0) - Number(left.items[0]?.score || 0)
      || new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime())
    .slice(0, 8);

  return {
    generatedAt,
    totalEvents: events.length,
    events
  };
}

function generateEvents() {
  const latest = readJson(LATEST_PATH, { items: [], generatedAt: "" });
  const data = buildEvents(latest.items || [], latest.generatedAt || new Date().toISOString());
  fs.mkdirSync(path.dirname(EVENTS_PATH), { recursive: true });
  fs.writeFileSync(EVENTS_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return data;
}

if (require.main === module) {
  const data = generateEvents();
  console.log(`Generated ${data.totalEvents} event clusters.`);
}

module.exports = {
  buildEvents,
  generateEvents
};
