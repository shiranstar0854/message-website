const crypto = require("node:crypto");
const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");
const { normalizeText, sortItems } = require("./lib/pipeline");

const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT_DIR, "data", "processed", "daily-events.json");

function clusterId(value) {
  return crypto.createHash("sha1").update(normalizeText(value).toLowerCase()).digest("hex").slice(0, 12);
}

function itemEntities(item) {
  return [...new Set([
    ...(item.entities || []),
    item.classification?.factors?.subject,
    ...(item.secondaryTags || [])
  ].map(normalizeText).filter(Boolean))].slice(0, 8);
}

function themeKey(items) {
  const top = sortItems(items)[0] || {};
  const identity = itemEntities(top).slice(0, 2).join("-") || top.category || top.eventType || "other";
  return `${top.category || "other"}:${top.eventType || "other"}:${identity}`.toLowerCase();
}

function sourceRows(items) {
  const rows = items.map((item) => ({ name: normalizeText(item.source), url: normalizeText(item.original_url || item.url), published_at: item.publishedAt || "" })).filter((source) => source.name && source.url);
  return [...new Map(rows.map((source) => [source.url, source])).values()];
}

function factRows(items) {
  return [...new Set(items.flatMap((item) => {
    const facts = item.confirmed_facts?.length ? item.confirmed_facts : [item.what_happened || item.article_brief?.core_fact?.summary || item.aiSummary || item.summary_zh || item.contentExcerpt || item.summary];
    return facts.map((fact) => normalizeText(fact?.text || fact)).filter(Boolean);
  }))].slice(0, 6).map((text) => ({ text, status: "confirmed" }));
}

function buildDailyEventsFromItems(items, generatedAt = new Date().toISOString(), limit = 5) {
  const groups = new Map();
  (items || []).forEach((item) => {
    const rawKey = item.eventClusterKey || `${item.category || "other"}|${item.eventType || "other"}|${item.classification?.factors?.subject || item.title}`;
    const key = clusterId(rawKey);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  const events = [...groups.entries()].map(([key, group]) => {
    const ranked = sortItems(group);
    const primary = ranked[0];
    const sources = sourceRows(ranked);
    const facts = factRows(ranked);
    const watches = [...new Set(ranked.flatMap((item) => item.article_brief?.watch_variables || item.watch_variables || []).map((entry) => normalizeText(entry.variable || entry)).filter(Boolean))].slice(0, 6);
    const gaps = [];
    if (sources.length < 2) gaps.push({ gap: "目前只有一个独立来源。" });
    if (primary.contentReviewStatus === "metadata-only") gaps.push({ gap: "主来源仅取得元数据，未取得完整正文。" });
    return {
      event_id: `daily-${key}`,
      theme_key: themeKey(ranked),
      title: primary.title_zh || primary.translatedTitle || primary.title,
      category: primary.category,
      event_type: primary.eventType || "other",
      importance_score: Number(primary.importance_score || primary.score || 0),
      summary: facts[0]?.text || "",
      why_it_matters: normalizeText(primary.why_it_matters || primary.article_brief?.impact?.direct || primary.importance || primary.what_changed || "该事件包含新的可验证事实，可能影响相关主体的后续决策。"),
      confirmed_facts: facts,
      key_data: primary.article_brief?.key_data || primary.key_data || [],
      current_progress: primary.article_brief?.current_progress || { stage: "uncertain", details: "现有材料没有明确标注实施阶段。" },
      watch_variables: watches.map((variable) => ({ variable })),
      entities: [...new Set(ranked.flatMap(itemEntities))].slice(0, 8),
      primary_source: sources[0] || {},
      supporting_sources: sources.slice(1),
      conflicting_evidence: ranked.flatMap((item) => item.counter_arguments || []).slice(0, 4),
      evidence_gaps: gaps,
      source_count: sources.length,
      related_item_ids: ranked.map((item) => item.id).filter(Boolean)
    };
  }).sort((a, b) => b.importance_score - a.importance_score || b.source_count - a.source_count);
  return { schema_version: "daily-events.v3", generated_at: generatedAt, events: events.slice(0, Math.min(5, Math.max(3, Number(limit || 5)))) };
}

function generateDailyEvents(options = {}) {
  const translated = options.items
    ? { items: options.items, generatedAt: options.generatedAt || "" }
    : readJson(path.join(ROOT_DIR, "data", "processed", "translated-items.json"), { items: [], generatedAt: "" });
  if (!(translated.items || []).length) return readJson(OUTPUT_PATH, { schema_version: "daily-events.v3", generated_at: "", events: [] });
  const eligible = (translated.items || []).filter((item) => item.translation_status !== "failed"
    || ["zh", "zh-CN"].includes(item.source_language || item.sourceLanguage)
    || /[\u4e00-\u9fff]/u.test(`${item.title_zh || item.title || ""} ${item.summary_zh || item.article_brief?.core_fact?.summary || ""}`));
  const output = buildDailyEventsFromItems(eligible, translated.generatedAt || options.generatedAt || new Date().toISOString(), options.limit || 5);
  writeJson(OUTPUT_PATH, output);
  return output;
}

if (require.main === module) {
  const data = generateDailyEvents();
  console.log(`Generated ${data.events.length} internal daily events.`);
}

module.exports = { buildDailyEventsFromItems, generateDailyEvents };
