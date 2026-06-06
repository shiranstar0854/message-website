const fs = require("node:fs");
const path = require("node:path");
const { readJson } = require("./lib/file-utils");
const { titleSimilarity } = require("./lib/pipeline");

const ROOT_DIR = path.resolve(__dirname, "..");
const LATEST_PATH = path.join(ROOT_DIR, "src", "data", "latest-items.json");
const EVENTS_PATH = path.join(ROOT_DIR, "src", "data", "events.json");
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
  return item.summary_zh || item.summaryZh || item.aiSummary || item.contentExcerpt || item.summary || "";
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
  ]), 8);
  return (values.length ? values : [fallbackLabel]).slice(0, 4);
}

function buildExplainedSummary(items, label) {
  return buildEventSummary(items, label);
}

function buildWhyItMatters(items, label) {
  const top = items[0] || {};
  if (top.importance || top.summaryReason) return top.importance || top.summaryReason;
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
  return itemKeywords(item)
    .map((keyword) => keyword.toLowerCase())
    .filter((keyword) => keyword.length >= 2 && !["daily", "media"].includes(keyword))
    .slice(0, 2)
    .join("|");
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
  const rule = ruleForItem(item) || fallbackRuleForItem(item);
  if (!rule) return null;
  if (groups.has(rule.id)) return groups.get(rule.id);

  const similar = [...groups.values()].find((group) => {
    const representative = group.items[0];
    const keywordOverlap = itemKeywords(item).some((keyword) => itemKeywords(representative).includes(keyword));
    return keywordOverlap && titleSimilarity(displayTitle(item), displayTitle(representative)) >= 0.34;
  });
  if (similar) return similar;

  const group = { id: rule.id, label: rule.label, items: [] };
  groups.set(rule.id, group);
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

  dedupeEventItems(items || []).forEach((item) => {
    const group = groupForItem(item, groups);
    if (!group) return;
    group.items.push(item);
  });

  const events = [...groups.values()]
    .map((group) => {
      const sortedItems = group.items
        .sort((left, right) => Number(right.score || 0) - Number(left.score || 0)
          || new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime());
      const topItems = sortedItems.slice(0, 6);
      const evidenceItems = buildEvidenceItems(topItems);
      const timeline = buildTimeline(sortedItems);
      const updatedAt = sortedItems
        .map((item) => item.publishedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || generatedAt;
      return {
        id: group.id,
        title: group.label,
        summary: buildExplainedSummary(topItems, group.label),
        whyItMatters: buildWhyItMatters(topItems, group.label),
        impactAreas: buildImpactAreas(topItems, group.label),
        watchlist: buildWatchlist(topItems, group.label),
        updatedAt,
        itemCount: sortedItems.length,
        heat: heatLabel(Number(topItems[0]?.score || 0), sortedItems.length),
        sources: [...new Set(sortedItems.map((item) => item.source).filter(Boolean))].slice(0, 6),
        keywords: [...new Set(sortedItems.flatMap((item) => [...(item.impactAreas || []), ...itemKeywords(item)]))].slice(0, 8),
        timeline,
        evidenceItems,
        items: evidenceItems
      };
    })
    .filter((event) => event.itemCount >= 2 && event.timeline.length >= 2)
    .sort((left, right) => Number(right.items[0]?.score || 0) - Number(left.items[0]?.score || 0)
      || new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime())
    .slice(0, Number(options.limit || 8));

  return {
    generatedAt,
    lookbackDays: Number(options.lookbackDays || EVENT_LOOKBACK_DAYS),
    totalEvents: events.length,
    events
  };
}

function generateEvents(options = {}) {
  const latest = readJson(LATEST_PATH, { items: [], generatedAt: "" });
  const generatedAt = latest.generatedAt || new Date().toISOString();
  const archiveItems = readArchiveItems(generatedAt, options);
  const data = buildEvents([...(archiveItems || []), ...(latest.items || [])], generatedAt, options);
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
  buildTimeline,
  generateEvents,
  readArchiveItems
};
