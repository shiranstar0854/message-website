const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readJson, readSources, writeJson } = require("./lib/file-utils");
const { normalizeText, truncateText } = require("./lib/pipeline");
const { isLlmConfigured, requestDeepSeekJson } = require("./lib/deepseek-summary-client");

const ROOT_DIR = path.resolve(__dirname, "..");
const SCHEMA_VERSION = "weekly-review.v3";
const SIGNAL_LEVELS = new Set(["weak", "medium", "strong", "unconfirmed"]);

function isoWeekId(date) {
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  return `${current.getUTCFullYear()}-W${String(Math.ceil((((current - yearStart) / 86400000) + 1) / 7)).padStart(2, "0")}`;
}

function loadDailyArchives(lookbackDays = 15, now = new Date()) {
  const directory = path.join(ROOT_DIR, "data", "archive", "daily");
  if (!fs.existsSync(directory)) return [];
  const earliest = new Date(now.getTime() - Number(lookbackDays) * 86400000);
  return fs.readdirSync(directory).filter((file) => file.endsWith(".json"))
    .map((file) => readJson(path.join(directory, file), null)).filter(Boolean)
    .filter((archive) => {
      const date = new Date(archive.generatedAt || archive.date || 0);
      return !Number.isNaN(date.getTime()) && date >= earliest && date <= now;
    }).sort((left, right) => String(left.date).localeCompare(String(right.date)));
}

function filterEnabledSourceItems(items, sources) {
  const enabled = sources.filter((source) => source.enabled !== false);
  const ids = new Set(enabled.map((source) => source.id));
  const names = new Set(enabled.map((source) => source.name));
  return items.filter((item) => {
    const primary = item.primary_source || {};
    if (primary.name || primary.id) return ids.has(primary.id) || names.has(primary.name);
    if (item.sourceId || item.source) return ids.has(item.sourceId) || names.has(item.source);
    return true;
  });
}

function uniqueLatestEvents(events) {
  const byId = new Map();
  events.forEach((event) => {
    const key = event.event_id || `${event.theme_key}:${event.title}`;
    const previous = byId.get(key);
    if (!previous || new Date(event.archived_at || 0) > new Date(previous.archived_at || 0)) byId.set(key, event);
  });
  return [...byId.values()];
}

function splitEventWindows(archives, now) {
  const currentEnd = new Date(now);
  currentEnd.setUTCHours(0, 0, 0, 0);
  currentEnd.setUTCMilliseconds(-1);
  const currentStart = new Date(currentEnd);
  currentStart.setUTCHours(0, 0, 0, 0);
  currentStart.setUTCDate(currentStart.getUTCDate() - 6);
  const previousStart = new Date(currentStart.getTime() - 7 * 86400000);
  const previousEnd = new Date(currentStart.getTime() - 1);
  const current = [];
  const previous = [];
  archives.forEach((archive) => {
    const date = new Date(archive.generatedAt || archive.date || 0);
    const events = (archive.events || []).map((event) => ({ ...event, archived_at: archive.generatedAt || archive.date }));
    if (date >= currentStart && date <= currentEnd) current.push(...events);
    else if (date >= previousStart && date <= previousEnd) previous.push(...events);
  });
  return { current: uniqueLatestEvents(current), previous: uniqueLatestEvents(previous), currentStart, currentEnd };
}

function stableId(prefix, value) {
  return `${prefix}-${crypto.createHash("sha1").update(normalizeText(value).toLowerCase()).digest("hex").slice(0, 12)}`;
}

function themeIdentity(event) {
  return event.theme_key || `${event.category || "other"}:${event.event_type || "other"}:${(event.entities || []).slice(0, 2).join("-") || event.title}`.toLowerCase();
}

function themeTitle(events, identity) {
  const entities = [...new Set(events.flatMap((event) => event.entities || []).map(normalizeText).filter(Boolean))].slice(0, 2);
  return entities.length ? `${entities.join("与")}相关变化` : normalizeText(events[0]?.title || identity);
}

function sourceRows(events) {
  const rows = events.flatMap((event) => [event.primary_source, ...(event.supporting_sources || [])])
    .map((source) => ({ name: normalizeText(source?.name || source?.source), url: normalizeText(source?.url) }))
    .filter((source) => source.name && source.url);
  return [...new Map(rows.map((source) => [source.url, source])).values()];
}

function signalStrength(events) {
  const sourceCount = sourceRows(events).length;
  if (events.length >= 3 && sourceCount >= 3) return { level: "strong", reason: `本周有${events.length}项事件和${sourceCount}个独立来源支持该信号。` };
  if (events.length >= 2 || sourceCount >= 2) return { level: "medium", reason: `本周有${events.length}项事件和${sourceCount}个来源，方向初步形成但仍需验证。` };
  if (events.length === 1) return { level: "weak", reason: "目前只有单一事件或有限来源，尚不足以确认趋势。" };
  return { level: "unconfirmed", reason: "没有足够事件证据确认该信号。" };
}

function previousJudgments(review) {
  const rows = [...(review?.major_events || []), ...(review?.category_trends || [])];
  return new Map(rows.filter((row) => row.theme_key && row.judgment_id).map((row) => [row.theme_key, row]));
}

function groupThemes(events) {
  const groups = new Map();
  events.forEach((event) => {
    const key = themeIdentity(event);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });
  return groups;
}

function buildThemeRow(identity, events, previousEvents, previousRow) {
  const ranked = [...events].sort((a, b) => Number(b.importance_score || 0) - Number(a.importance_score || 0));
  const top = ranked[0] || {};
  const conclusion = truncateText(top.why_it_matters || top.summary || top.title, 260);
  return {
    theme_key: identity,
    judgment_id: previousRow?.judgment_id || stableId("judgment", identity),
    judgment_version: previousRow && normalizeText(previousRow.conclusion) !== normalizeText(conclusion) ? Number(previousRow.judgment_version || 1) + 1 : Number(previousRow?.judgment_version || 1),
    title: themeTitle(ranked, identity),
    conclusion,
    change_from_previous_week: previousEvents.length
      ? `本周记录${ranked.length}项相关事件，上周为${previousEvents.length}项；数量变化只表示证据覆盖变化，不单独作为趋势结论。`
      : "上周没有同主题事件，本周首次形成新版观察基线。",
    evidence: ranked.slice(0, 5).map((event) => ({ event_id: event.event_id, fact: truncateText(event.confirmed_facts?.[0]?.text || event.summary || event.title, 220), source_url: event.primary_source?.url || "" })),
    impact: truncateText(top.why_it_matters || "现实影响取决于后续执行、市场反馈和独立证据。", 220),
    risks: [...new Set(ranked.flatMap((event) => event.evidence_gaps || []).map((gap) => normalizeText(gap.gap || gap)).filter(Boolean))],
    signal: signalStrength(ranked),
    has_conflict: ranked.some((event) => (event.conflicting_evidence || []).length > 0)
  };
}

function weeklyTextLength(review) {
  return JSON.stringify({ ...review, schema_version: "", updated_at: "", week_range: {}, sources: [] })
    .replace(/[\[\]{}"_:,0-9a-zA-Z-]/g, "").replace(/\s/g, "").length;
}

function buildWeeklyReview(archives, rules = {}, nowIso = new Date().toISOString(), previousReview = null) {
  const split = splitEventWindows(archives, new Date(nowIso));
  const currentGroups = groupThemes(split.current);
  const previousGroups = groupThemes(split.previous);
  const previous = previousJudgments(previousReview);
  const themes = [...currentGroups.entries()].map(([identity, events]) => buildThemeRow(identity, events, previousGroups.get(identity) || [], previous.get(identity)))
    .sort((a, b) => ["strong", "medium", "weak", "unconfirmed"].indexOf(a.signal.level) - ["strong", "medium", "weak", "unconfirmed"].indexOf(b.signal.level))
    .slice(0, 5);
  const majorEvents = [...split.current].sort((a, b) => Number(b.importance_score || 0) - Number(a.importance_score || 0)).slice(0, 6).map((event) => {
    const identity = themeIdentity(event);
    const theme = themes.find((row) => row.theme_key === identity);
    return {
      event_id: event.event_id,
      theme_key: identity,
      judgment_id: theme?.judgment_id || stableId("judgment", identity),
      title: normalizeText(event.title),
      what_happened: truncateText(event.confirmed_facts?.[0]?.text || event.summary || event.title, 240),
      why_important: truncateText(event.why_it_matters || "该事件包含可能影响后续判断的新事实。", 180),
      current_progress: normalizeText(event.current_progress?.details || "现有档案仅确认已公开事实，完整执行结果仍待观察。"),
      source_url: event.primary_source?.url || ""
    };
  });
  const validation = { verified: [], pending: [], falsified: [], deviated: [] };
  themes.forEach((theme) => {
    const prior = previous.get(theme.theme_key);
    const row = { judgment_id: theme.judgment_id, theme_key: theme.theme_key, reason: "" };
    if (!prior) validation.pending.push({ ...row, reason: "没有上周新版判断基线。" });
    else if (theme.has_conflict) validation.falsified.push({ ...row, reason: "本周出现与原判断方向相反的明确证据。" });
    else if (normalizeText(prior.conclusion) === normalizeText(theme.conclusion) && theme.signal.level !== "weak") validation.verified.push({ ...row, reason: "新增证据继续支持原判断。" });
    else validation.deviated.push({ ...row, reason: "新增证据改变了原判断的范围或表述，需要继续验证。" });
  });
  for (const prior of previous.values()) {
    if (!themes.some((theme) => theme.theme_key === prior.theme_key)) validation.pending.push({ judgment_id: prior.judgment_id, theme_key: prior.theme_key, reason: "本周没有新增同主题证据，不能据此判定原判断失效。" });
  }
  const categoryTrends = themes.filter((theme) => theme.signal.level !== "unconfirmed").map((theme) => ({
    theme_key: theme.theme_key,
    judgment_id: theme.judgment_id,
    theme: theme.title,
    conclusion: theme.conclusion,
    change_from_previous_week: theme.change_from_previous_week,
    evidence: theme.evidence,
    impact: theme.impact,
    signal: theme.signal
  }));
  const keyDataChanges = split.current.flatMap((event) => (event.key_data || []).map((entry) => ({
    metric: normalizeText(entry.metric || entry.label), current_value: normalizeText(entry.value), comparison_baseline: normalizeText(entry.comparison || entry.baseline),
    change: normalizeText(entry.change), meaning: normalizeText(entry.meaning || entry.context), source_url: normalizeText(entry.source_url || event.primary_source?.url)
  }))).filter((entry) => entry.metric && entry.current_value && entry.comparison_baseline && entry.change && entry.meaning).slice(0, 10);
  const review = {
    schema_version: SCHEMA_VERSION,
    updated_at: nowIso,
    week_range: { start: split.currentStart.toISOString().slice(0, 10), end: split.currentEnd.toISOString().slice(0, 10) },
    weekly_thesis: themes.length ? `本周形成${themes.length}条可继续验证的变化主线。核心结论来自事件事实、跨周证据覆盖和来源独立性；事件数量变化本身不等于趋势，仍需用执行结果、市场或政策反馈检验。` : "最近7个完整自然日缺少可用事件档案，暂不形成趋势判断。",
    major_events: majorEvents,
    category_trends: categoryTrends,
    key_data_changes: keyDataChanges,
    cross_event_links: themes.length >= 2 ? [{ related_judgment_ids: themes.slice(0, 3).map((theme) => theme.judgment_id), logic_chain: themes.slice(0, 3).map((theme) => `${theme.title}提供独立证据`), interpretation: "这些信号在时间上并行出现，但现有证据不足以确认直接因果；共同方向需要由后续执行和反馈数据验证。", evidence_urls: [...new Set(themes.slice(0, 3).flatMap((theme) => theme.evidence.map((entry) => entry.source_url)).filter(Boolean))] }] : [],
    market_policy_feedback: split.current.filter((event) => event.market_feedback || event.policy_feedback).slice(0, 8).map((event) => ({ event_id: event.event_id, market_feedback: normalizeText(event.market_feedback), policy_feedback: normalizeText(event.policy_feedback), evidence: event.primary_source?.url || "" })),
    previous_week_validation: validation,
    cognitive_updates: themes.filter((theme) => previous.has(theme.theme_key) && normalizeText(previous.get(theme.theme_key).conclusion) !== normalizeText(theme.conclusion)).map((theme) => ({ judgment_id: theme.judgment_id, previous_judgment: normalizeText(previous.get(theme.theme_key).conclusion), updated_judgment: theme.conclusion, reason: theme.change_from_previous_week })),
    new_signals: themes.map((theme) => ({ judgment_id: theme.judgment_id, signal: theme.title, level: SIGNAL_LEVELS.has(theme.signal.level) ? theme.signal.level : "unconfirmed", reason: theme.signal.reason })),
    risks_and_uncertainties: themes.flatMap((theme) => theme.risks.length ? theme.risks.map((risk) => ({ judgment_id: theme.judgment_id, risk })) : [{ judgment_id: theme.judgment_id, risk: "来源和时间覆盖仍有限，后续正式材料可能修正当前结论。" }]),
    personal_implications: {
      learning: themes.length ? ["优先学习如何核对原始文件、比较基准和跨来源证据，不把单条新闻当作趋势。"] : [],
      career: [],
      skills: themes.length ? ["继续强化数据核验、来源审计和条件性判断表达能力。"] : [],
      industry_understanding: categoryTrends.slice(0, 3).map((theme) => `跟踪${theme.theme}的执行结果，而不是只记录公开表态。`),
      investment_watch: themes.length ? ["仅记录可能影响市场预期的变量和证据，不构成投资建议。"] : [],
      project_building: themes.length ? ["项目中保留稳定判断ID、证据来源和失效条件，便于下周复核。"] : []
    },
    next_week_watchlist: themes.map((theme) => ({ judgment_id: theme.judgment_id, observation: `${theme.title}的正式文件、执行动作与反馈数据`, confirmation_condition: "未来7天出现至少两项独立且可验证的新证据继续支持当前方向。", invalidation_condition: "正式文件、可复核数据或主体行动与当前判断方向相反。", evidence_needed: ["正式文件或原始数据", "至少一个独立补充来源", "相关主体后续行动"] })),
    sources: sourceRows(split.current),
    limitations: []
  };
  if (!previousReview) review.limitations.push("没有上周 weekly-review.v3 基线，旧版周报不作为判断追踪依据。");
  if (themes.length < 3) review.limitations.push("本周有效变化主题少于3个，未平均填满分类或重复内容。");
  if (!keyDataChanges.length) review.limitations.push("事件档案缺少同时具备本周值、比较基准、变化和含义的数据，关键数据变化字段留空。");
  if (weeklyTextLength(review) < 1200) review.limitations.push("可用事实不足以达到目标篇幅，未使用无来源内容补足字数。");
  return review;
}

function weeklyPrompt(review) {
  return [
    "Return strict valid JSON only. Improve the Chinese weekly review using only supplied facts, IDs, numbers and URLs.",
    "Keep the exact weekly-review.v3 root shape. Do not add themes, events, causal claims or investment advice.",
    "The content fields should total 1200-2000 Chinese characters. Keep stable judgment_id values.",
    JSON.stringify(review)
  ].join("\n");
}

function validateWeeklyResponse(base, response) {
  if (!response || response.schema_version !== SCHEMA_VERSION) return null;
  const required = ["weekly_thesis", "major_events", "category_trends", "key_data_changes", "cross_event_links", "market_policy_feedback", "previous_week_validation", "cognitive_updates", "new_signals", "risks_and_uncertainties", "personal_implications", "next_week_watchlist", "sources", "limitations"];
  if (required.some((key) => response[key] === undefined)) return null;
  const inputIds = new Set(JSON.stringify(base).match(/(?:judgment|daily)-[a-f0-9]{12}/g) || []);
  const outputIds = JSON.stringify(response).match(/(?:judgment|daily)-[a-f0-9]{12}/g) || [];
  if (outputIds.some((id) => !inputIds.has(id))) return null;
  const inputNumbers = new Set(JSON.stringify(base).match(/\b\d+(?:\.\d+)?%?\b/g) || []);
  const comparable = { ...response, schema_version: "", updated_at: "", week_range: {} };
  const outputNumbers = JSON.stringify(comparable).match(/\b\d+(?:\.\d+)?%?\b/g) || [];
  if (outputNumbers.some((number) => !inputNumbers.has(number))) return null;
  const merged = { ...response, schema_version: SCHEMA_VERSION, updated_at: base.updated_at, week_range: base.week_range, sources: base.sources };
  return weeklyTextLength(merged) >= 1200 && weeklyTextLength(merged) <= 2000 ? merged : null;
}

async function enhanceWeeklyReviewWithLlm(review, rules = {}, generatedAt = new Date().toISOString(), options = {}) {
  if (!isLlmConfigured(rules, options.env || process.env) || !review.major_events.length) return review;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await requestDeepSeekJson(weeklyPrompt(review), rules, options);
      const validated = validateWeeklyResponse(review, response);
      if (validated) return validated;
    } catch (error) {
      if (attempt === 1) review.limitations.push(`模型周报生成失败，已保留本地版本：${truncateText(error.message, 80)}`);
    }
  }
  review.limitations.push("模型周报未通过结构、字数或事实白名单校验，已保留本地版本。");
  return review;
}

async function generateWeeklyReview(nowIso = new Date().toISOString(), options = {}) {
  const rules = readJson(path.join(ROOT_DIR, "config", "ai-summary-rules.json"), {});
  const sources = readSources(ROOT_DIR);
  const archives = loadDailyArchives(15, new Date(nowIso)).map((archive) => ({ ...archive, events: filterEnabledSourceItems(archive.events || [], sources) }));
  const weekId = isoWeekId(new Date(nowIso));
  const weeklyDir = path.join(ROOT_DIR, "data", "archive", "weekly");
  const previousFiles = fs.existsSync(weeklyDir) ? fs.readdirSync(weeklyDir).filter((file) => file.endsWith(".json") && file !== `${weekId}.json`).sort().reverse() : [];
  const previousReview = previousFiles.map((file) => readJson(path.join(weeklyDir, file), null)).find((review) => review?.schema_version === SCHEMA_VERSION) || null;
  const review = await enhanceWeeklyReviewWithLlm(buildWeeklyReview(archives, rules, nowIso, previousReview), rules, nowIso, options);
  writeJson(path.join(ROOT_DIR, "src", "data", "weekly-review.json"), review);
  writeJson(path.join(weeklyDir, `${weekId}.json`), review);
  return review;
}

if (require.main === module) {
  generateWeeklyReview().then((review) => console.log(`Generated ${isoWeekId(new Date(review.updated_at))} with ${review.major_events.length} major events.`)).catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { SCHEMA_VERSION, isoWeekId, loadDailyArchives, splitEventWindows, buildWeeklyReview, enhanceWeeklyReviewWithLlm, filterEnabledSourceItems, generateWeeklyReview, validateWeeklyResponse, weeklyTextLength };
