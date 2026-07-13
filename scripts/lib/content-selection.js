const crypto = require("node:crypto");
const { normalizeText, titleSimilarity } = require("./pipeline");
const { classifyMetadataCategory } = require("./classification");

const PRIORITY_EVENT_TYPES = new Set(["policy_change", "product_launch", "technology_upgrade", "earnings_guidance", "economic_data", "market_move", "security_incident", "research_result"]);
const CRITICAL_EVENT_TYPES = new Set(["policy_change", "economic_data", "security_incident"]);
const EVENT_RULES = [
  ["promotion", /招聘|诚聘|促销|优惠|折扣|报名|活动预告|会议预告|coupon|promo|sponsored|giveaway|job opening|hiring/i],
  ["security_incident", /漏洞|攻击|入侵|泄露|安全事件|breach|cyberattack|vulnerability|ransomware|zero-day/i],
  ["policy_change", /政策|监管|法规|法案|条例|规则|制裁|批准|禁令|regulation|policy|law|rule|sanction|ban|approved/i],
  ["earnings_guidance", /财报|营收|利润|亏损|指引|earnings|revenue|profit|guidance|quarterly results/i],
  ["economic_data", /gdp|cpi|ppi|通胀|就业|失业|零售销售|经济数据|industrial production|payroll/i],
  ["product_launch", /发布|推出|上线|正式开放|launch|released|unveiled|introduces|announces.*product/i],
  ["technology_upgrade", /升级|更新|新版本|性能提升|架构|模型能力|upgrade|update|new version|architecture|benchmark/i],
  ["research_result", /研究|论文|实验|临床|发现|research|paper|study|journal|arxiv|trial/i],
  ["market_move", /大涨|大跌|暴跌|暴涨|新高|新低|熔断|波动|surge|plunge|selloff|record high|market move/i],
  ["commentary", /评论|观点|解读|专栏|opinion|commentary|analysis/i],
  ["company_update", /公司|企业|任命|合作|扩张|裁员|company|appoint|partnership|expansion|layoff/i]
];
const CLUSTER_STOPWORDS = new Set(["the", "and", "with", "from", "after", "new", "update", "report", "announces", "发布", "宣布", "最新", "相关", "公司"]);

function textOf(item) {
  return normalizeText(`${item.title || ""} ${item.summary || ""} ${item.contentExcerpt || ""} ${(item.tags || []).join(" ")}`);
}

function sourcePolicyTier(item = {}) {
  const explicit = normalizeText(item.sourcePolicyTier || "").toLowerCase();
  if (["core", "standard", "experimental"].includes(explicit)) return explicit;
  const tier = normalizeText(item.sourceTier).toUpperCase();
  if (tier === "S" || ["official-agency", "official-market"].includes(item.sourceAuthority)) return "core";
  if (["A", "B"].includes(tier) || item.sourceAuthority === "official-media" || Number(item.credibility || 0) >= 80) return "standard";
  return "experimental";
}

function classifyEventType(item) {
  const text = textOf(item);
  return EVENT_RULES.find(([, pattern]) => pattern.test(text))?.[0] || "other";
}

function hasVerifiableFact(item) {
  return /\b\d+(?:\.\d+)?%?\b|20\d{2}|宣布|发布|批准|确认|报告|数据显示|announced|released|approved|confirmed|reported|data show/i.test(textOf(item));
}

function completenessScore(item) {
  let score = 0;
  if (normalizeText(item.title).length >= 12) score += 4;
  if (normalizeText(item.summary || item.contentExcerpt).length >= 50) score += 4;
  if (hasVerifiableFact(item)) score += 4;
  if (item.publishedAt && !item.publishedAtInferred) score += 3;
  return score;
}

function informationGain(item, recentItems = []) {
  if (!recentItems.length) return 16;
  const maxSimilarity = recentItems.filter((entry) => entry.id !== item.id)
    .reduce((maximum, entry) => Math.max(maximum, titleSimilarity(item.title, entry.title)), 0);
  return Math.max(0, Math.round(20 * (1 - maxSimilarity)));
}

function topicRelevance(item, eventType) {
  const text = textOf(item);
  let value = PRIORITY_EVENT_TYPES.has(eventType) ? 14 : 7;
  if (/人工智能|芯片|模型|市场|利率|经济|政策|监管|科学|安全|AI|chip|market|policy|science|security/i.test(text)) value += 4;
  if (hasVerifiableFact(item)) value += 2;
  return Math.min(20, value);
}

function candidateValue(item, recentItems = [], rules = {}) {
  const eventType = item.eventType || classifyEventType(item);
  const authority = { core: 20, standard: 14, experimental: 7 }[sourcePolicyTier(item)];
  const typeValue = PRIORITY_EVENT_TYPES.has(eventType) ? 25 : eventType === "company_update" ? 11 : eventType === "commentary" ? 6 : 8;
  const blocked = (rules.blockedPatterns || []).some((pattern) => textOf(item).toLowerCase().includes(String(pattern).toLowerCase()));
  let value = authority + typeValue + topicRelevance(item, eventType) + informationGain(item, recentItems) + completenessScore(item);
  if (blocked || eventType === "promotion") value -= 60;
  if (["commentary", "company_update"].includes(eventType) && !hasVerifiableFact(item)) value -= 25;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clusterTokens(item) {
  const title = normalizeText(item.title).toLowerCase();
  const latin = title.split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !CLUSTER_STOPWORDS.has(word));
  const entities = [...title.matchAll(/[\u4e00-\u9fff]{2,10}(?:公司|银行|大学|委员会|部门|政府)?/gu)].map((match) => match[0]).filter((word) => !CLUSTER_STOPWORDS.has(word));
  return [...new Set([...latin, ...entities])].slice(0, 12);
}

function tokenSimilarity(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (!leftSet.size || !rightSet.size) return 0;
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  return intersection / Math.min(leftSet.size, rightSet.size);
}

function sameProvisionalEvent(item, representative) {
  if (item.eventType !== representative.eventType) return false;
  return titleSimilarity(item.title, representative.title) >= 0.42
    || tokenSimilarity(item.clusterTokens, representative.clusterTokens) >= 0.5;
}

function eventClusterKey(item) {
  const tokens = item.clusterTokens || clusterTokens(item);
  return crypto.createHash("sha1").update(`${item.eventType || classifyEventType(item)}:${tokens.slice(0, 6).sort().join("|")}`).digest("hex").slice(0, 12);
}

function assignEventClusters(items) {
  const clusters = [];
  return items.map((item) => {
    const prepared = { ...item, clusterTokens: clusterTokens(item) };
    let cluster = clusters.find((entry) => sameProvisionalEvent(prepared, entry.representative));
    if (!cluster) {
      cluster = { key: eventClusterKey(prepared), representative: prepared };
      clusters.push(cluster);
    }
    return { ...prepared, eventClusterKey: cluster.key };
  });
}

function selectCandidates(items, options = {}) {
  const rules = options.rules || {};
  const recentItems = options.recentItems || [];
  const rejected = [];
  const selected = [];
  const prepared = assignEventClusters(items.map((item) => {
    const eventType = classifyEventType(item);
    const sourcePolicyTierValue = sourcePolicyTier(item);
    const candidateCategory = classifyMetadataCategory({ ...item, eventType });
    return { ...item, eventType, candidateCategory, sourcePolicyTier: sourcePolicyTierValue, candidateValue: candidateValue({ ...item, eventType, sourcePolicyTier: sourcePolicyTierValue }, recentItems, rules) };
  }));
  const remaining = [...prepared];
  const sourceCounts = new Map();
  const categoryCounts = new Map();
  const eventCounts = new Map();
  const clusterSources = new Map();

  while (remaining.length) {
    remaining.sort((left, right) => {
      const leftDiversity = left.candidateValue - (sourceCounts.get(left.sourceId || left.source) || 0) * 3 - (clusterSources.get(left.eventClusterKey)?.size || 0) * 2;
      const rightDiversity = right.candidateValue - (sourceCounts.get(right.sourceId || right.source) || 0) * 3 - (clusterSources.get(right.eventClusterKey)?.size || 0) * 2;
      return rightDiversity - leftDiversity || new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0);
    });
    const item = remaining.shift();
    const sourceKey = item.sourceId || item.source;
    const sourceQuota = Number(item.bodyFetchQuota || rules.sourceTierQuotas?.[item.sourcePolicyTier] || 1);
    const clusterSet = clusterSources.get(item.eventClusterKey) || new Set();
    let reason = "";
    if (item.candidateValue < Number(rules.candidateThreshold || 60)) reason = "below-candidate-threshold";
    else if (selected.length >= Number(rules.globalBodyFetchQuota || 36)) reason = "global-quota";
    else if ((sourceCounts.get(sourceKey) || 0) >= sourceQuota) reason = "source-quota";
    else if ((categoryCounts.get(item.candidateCategory) || 0) >= Number(rules.categoryQuota || 8)) reason = "category-quota";
    else if (!CRITICAL_EVENT_TYPES.has(item.eventType) && (eventCounts.get(item.eventType) || 0) >= Number(rules.eventTypeQuota || 5)) reason = "event-type-quota";
    else if (!clusterSet.has(sourceKey) && clusterSet.size >= Number(rules.eventClusterQuota || 3)) reason = "event-cluster-quota";
    if (reason) {
      rejected.push({ ...item, candidateStatus: "rejected", candidateReason: reason });
      continue;
    }
    selected.push({ ...item, candidateStatus: "selected" });
    sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) || 0) + 1);
    categoryCounts.set(item.candidateCategory, (categoryCounts.get(item.candidateCategory) || 0) + 1);
    eventCounts.set(item.eventType, (eventCounts.get(item.eventType) || 0) + 1);
    clusterSet.add(sourceKey);
    clusterSources.set(item.eventClusterKey, clusterSet);
  }
  return { selected, rejected, prepared };
}

function assessContent(item) {
  const body = normalizeText(item.bodyText || item.contentExcerpt || "");
  const facts = body.match(/宣布|发布|批准|确认|报告|数据显示|表示|指出|要求|强调|实施|启动|完成|交付|增长|下降|announced|released|approved|confirmed|reported|stated|launched|implemented|completed|delivered|increased|decreased/gi) || [];
  const numbers = body.match(/\b\d+(?:\.\d+)?%?\b|20\d{2}/g) || [];
  const entities = body.match(/[A-Z][A-Za-z]{2,}|[\u4e00-\u9fff]{2,}(?:公司|部门|委员会|银行|政府|大学)|国务院|证监会|人民银行|科技部|财政部|国家统计局|发展改革委/gu) || [];
  const evidence = /公告|原文|文件|会议|调研|部署|论文|研究|filing|paper|study|official|report/i.test(body);
  const lengthScore = Math.min(10, Math.round(body.length / 180));
  const contentDensity = Math.min(100, Math.min(35, facts.length * 7) + Math.min(20, numbers.length * 4) + Math.min(20, entities.length * 3) + (evidence ? 15 : 0) + lengthScore);
  return { bodyLength: body.length, contentDensity, newFactCount: Math.min(20, facts.length + numbers.length) };
}

module.exports = { PRIORITY_EVENT_TYPES, CRITICAL_EVENT_TYPES, sourcePolicyTier, classifyEventType, hasVerifiableFact, candidateValue, clusterTokens, eventClusterKey, assignEventClusters, selectCandidates, assessContent };
