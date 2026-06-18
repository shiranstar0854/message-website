const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");
const { loadLocalEnv } = require("./lib/load-local-env");
const { getLlmConfig, isLlmConfigured, requestDeepSeekJson } = require("./lib/deepseek-summary-client");
const { normalizeText, truncateText } = require("./lib/pipeline");

const ROOT_DIR = path.resolve(__dirname, "..");
const EVENTS_PATH = path.join(ROOT_DIR, "src", "data", "events.json");
const RULES_PATH = path.join(ROOT_DIR, "config", "ai-summary-rules.json");
const IMPACT_KEYS = ["market", "industry", "company", "user"];
const TRACKING_DECISIONS = new Set(["值得追踪", "暂时观察", "不值得追踪"]);
const CONFIDENCE_LEVELS = new Set(["高", "中", "低"]);

function buildEventAnalysisRules(rules = {}) {
  const llm = rules.llmProduction || {};
  return {
    ...rules,
    llmProduction: {
      ...llm,
      requiredSecret: llm.eventRequiredSecret || llm.requiredSecret || "DEEPSEEK_API_KEY",
      maxOutputTokens: Number(llm.eventMaxOutputTokens || llm.maxOutputTokens || 1400)
    }
  };
}

function normalizeList(value, limit = 6) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(normalizeText).filter(Boolean))].slice(0, limit);
}

function normalizeImpactAnalysis(value, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(IMPACT_KEYS.map((key) => [
    key,
    truncateText(normalizeText(source[key] || fallback[key] || "目前证据不足"), 220)
  ]));
}

function normalizeSourceLinks(value, event = {}) {
  const links = Array.isArray(value) ? value : [];
  const normalized = links.map((entry) => {
    if (typeof entry === "string") return { title: "", url: normalizeText(entry) };
    return {
      title: truncateText(entry?.title || entry?.source || "", 120),
      url: normalizeText(entry?.url || "")
    };
  }).filter((entry) => entry.url);

  if (!normalized.length) {
    (event.related_articles || event.evidenceItems || event.items || []).slice(0, 5).forEach((item) => {
      if (item?.url) {
        normalized.push({
          title: truncateText(item.title || item.source || "原文", 120),
          url: item.url
        });
      }
    });
  }

  return normalized.slice(0, 8);
}

function compactEventForPrompt(event = {}) {
  return {
    id: event.event_id || event.id,
    title: event.title,
    current_summary: event.summary || event.one_sentence_summary,
    decision_lane: event.decisionLaneLabel || event.decisionLane,
    decision_grade: event.decisionGrade,
    decision_signal: event.decisionSignal,
    current_status: event.current_status,
    confidence_level: event.confidence_level,
    source_quality: event.sourceQuality,
    market_context: event.marketContext,
    confirmed_facts: event.confirmed_facts || event.confirmedFacts || [],
    current_impact_analysis: event.impact_analysis,
    current_uncertainties: event.uncertainties || event.riskFactors || [],
    current_watch_variables: event.watch_variables || event.watchlist || [],
    timeline: (event.timeline || event.keyDevelopments || []).slice(-10).map((item) => ({
      date: item.date || item.publishedAt,
      title: item.title,
      summary: item.summary || item.description,
      source: item.source,
      evidence_type: item.evidence_type,
      importance: item.importance,
      url: item.url,
      score: item.score
    })),
    sources: (event.related_articles || event.evidenceItems || event.items || []).slice(0, 10).map((item) => ({
      title: item.title,
      summary: item.summary,
      source: item.source,
      url: item.url,
      published_at: item.published_at || item.publishedAt,
      relevance_score: item.relevance_score || item.score
    }))
  };
}

function buildEventAnalysisPrompt(event) {
  return [
    "你是一个中文重点事件追踪系统的事件分析员。",
    "只基于输入材料做分析；不要编造来源、数字、结论或因果关系。",
    "必须区分已确认事实、推断影响、不确定性和后续观察变量。",
    "证据不足时写“目前证据不足”。不要使用重大、颠覆性、革命性等夸张词。",
    "返回严格 JSON，不要 markdown，不要注释。",
    "JSON 结构必须是：",
    "{\"what_happened\":\"\",\"confirmed_facts\":[],\"what_changed\":\"\",\"impact_analysis\":{\"market\":\"\",\"industry\":\"\",\"company\":\"\",\"user\":\"\"},\"uncertainties\":[],\"watch_variables\":[],\"tracking_decision\":\"值得追踪 | 暂时观察 | 不值得追踪\",\"confidence_level\":\"高 | 中 | 低\",\"source_links\":[{\"title\":\"\",\"url\":\"\"}],\"analysis_notes\":[],\"my_questions\":[]}",
    "",
    JSON.stringify(compactEventForPrompt(event), null, 2)
  ].join("\n");
}

function validateEventAnalysis(value, event = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Event analysis response must be a JSON object.");
  }

  const whatHappened = truncateText(normalizeText(value.what_happened || event.one_sentence_summary || event.summary), 220);
  const confirmedFacts = normalizeList(value.confirmed_facts || event.confirmed_facts || event.confirmedFacts, 8);
  const whatChanged = truncateText(normalizeText(value.what_changed || event.whyItMatters || event.decisionBrief || "目前证据不足"), 260);
  const trackingDecision = TRACKING_DECISIONS.has(value.tracking_decision) ? value.tracking_decision : "暂时观察";
  const confidenceLevel = CONFIDENCE_LEVELS.has(value.confidence_level) ? value.confidence_level : (event.confidence_level || "中");

  if (!whatHappened && !confirmedFacts.length) {
    throw new Error("Event analysis response is empty.");
  }

  return {
    what_happened: whatHappened || "目前证据不足",
    confirmed_facts: confirmedFacts.length ? confirmedFacts : ["目前证据不足"],
    what_changed: whatChanged,
    impact_analysis: normalizeImpactAnalysis(value.impact_analysis, event.impact_analysis),
    uncertainties: normalizeList(value.uncertainties || event.uncertainties || event.riskFactors, 8),
    watch_variables: normalizeList(value.watch_variables || event.watch_variables || event.watchlist, 8),
    tracking_decision: trackingDecision,
    confidence_level: confidenceLevel,
    source_links: normalizeSourceLinks(value.source_links, event),
    analysis_notes: normalizeList(value.analysis_notes, 6),
    my_questions: normalizeList(value.my_questions, 6)
  };
}

function applyEventAnalysis(event, analysis, generatedAt, model) {
  return {
    ...event,
    summary: analysis.what_happened,
    one_sentence_summary: analysis.what_happened,
    decisionBrief: analysis.what_changed,
    whyItMatters: analysis.what_changed,
    confirmedFacts: analysis.confirmed_facts,
    confirmed_facts: analysis.confirmed_facts,
    impact_analysis: analysis.impact_analysis,
    uncertainties: analysis.uncertainties,
    watchlist: analysis.watch_variables,
    watch_variables: analysis.watch_variables,
    related_articles: analysis.source_links.map((link) => ({
      title: link.title,
      url: link.url
    })),
    my_questions: analysis.my_questions,
    analysis_notes: analysis.analysis_notes,
    tracking_decision: analysis.tracking_decision,
    confidence_level: analysis.confidence_level,
    llm_analysis: analysis,
    llm_analysis_status: "succeeded",
    llm_analysis_model: model,
    llm_analysis_generated_at: generatedAt
  };
}

function buildFallbackEventAnalysis(event = {}) {
  return validateEventAnalysis({
    what_happened: event.one_sentence_summary || event.summary,
    confirmed_facts: event.confirmed_facts || event.confirmedFacts,
    what_changed: event.whyItMatters || event.decisionBrief,
    impact_analysis: event.impact_analysis,
    uncertainties: event.uncertainties || event.riskFactors,
    watch_variables: event.watch_variables || event.watchlist,
    tracking_decision: event.decisionGrade === "A" ? "值得追踪" : "暂时观察",
    confidence_level: event.confidence_level,
    source_links: event.related_articles || event.evidenceItems || event.items,
    analysis_notes: event.analysis_notes,
    my_questions: event.my_questions
  }, event);
}

async function analyzeEvent(event, rules = {}, generatedAt = new Date().toISOString(), options = {}) {
  const responseJson = await requestDeepSeekJson(buildEventAnalysisPrompt(event), rules, options);
  const analysis = validateEventAnalysis(responseJson, event);
  return applyEventAnalysis(event, analysis, generatedAt, getLlmConfig(rules, options.env || process.env).model);
}

async function analyzeEventsData(eventsData, rules = {}, generatedAt = new Date().toISOString(), options = {}) {
  const env = options.env || process.env;
  const eventRules = buildEventAnalysisRules(rules);
  const configured = isLlmConfigured(eventRules, env);
  const stats = {
    llmEnabled: Boolean(eventRules.llmProduction?.enabled),
    llmConfigured: configured,
    llmAttempted: 0,
    llmSucceeded: 0,
    fallbackCount: 0,
    errorCount: 0,
    generatedAt
  };
  const errors = [];

  if (!configured || eventRules.llmProduction?.enabled === false) {
    return {
      ...eventsData,
      eventAnalysisStats: stats,
      events: (eventsData.events || []).map((event) => ({
        ...event,
        llm_analysis_status: "skipped"
      }))
    };
  }

  const events = [];
  for (const event of eventsData.events || []) {
    stats.llmAttempted += 1;
    try {
      const analyzed = await analyzeEvent(event, eventRules, generatedAt, { ...options, env });
      stats.llmSucceeded += 1;
      events.push(analyzed);
    } catch (error) {
      stats.fallbackCount += 1;
      stats.errorCount += 1;
      errors.push({
        id: event.event_id || event.id,
        message: truncateText(error.message || "Event LLM analysis failed.", 180)
      });
      const fallbackAnalysis = buildFallbackEventAnalysis(event);
      events.push({
        ...applyEventAnalysis(event, fallbackAnalysis, generatedAt, "extractive"),
        llm_analysis_status: "fallback",
        llm_analysis_error: truncateText(error.message || "Event LLM analysis failed.", 180),
        llm_analysis_generated_at: generatedAt
      });
    }
  }

  return {
    ...eventsData,
    eventAnalysisStats: stats,
    ...(errors.length ? { eventAnalysisErrors: errors.slice(0, 20) } : {}),
    events
  };
}

async function generateEventAnalysis(nowIso = new Date().toISOString(), options = {}) {
  const rules = readJson(RULES_PATH, {});
  const eventsData = readJson(EVENTS_PATH, { events: [] });
  const analyzed = await analyzeEventsData(eventsData, rules, nowIso, options);
  writeJson(EVENTS_PATH, analyzed);
  return analyzed.eventAnalysisStats || {};
}

if (require.main === module) {
  loadLocalEnv(ROOT_DIR);
  generateEventAnalysis()
    .then((stats) => {
      console.log(`Generated event LLM analysis. LLM attempts: ${stats.llmAttempted || 0}; succeeded: ${stats.llmSucceeded || 0}.`);
      if (stats.errorCount > 0) {
        console.log(`Event analysis fallbacks: ${stats.fallbackCount}; API errors: ${stats.errorCount}.`);
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  applyEventAnalysis,
  analyzeEvent,
  analyzeEventsData,
  buildFallbackEventAnalysis,
  buildEventAnalysisPrompt,
  buildEventAnalysisRules,
  compactEventForPrompt,
  generateEventAnalysis,
  validateEventAnalysis
};
