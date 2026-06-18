const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");
const { loadLocalEnv } = require("./lib/load-local-env");
const { getLlmConfig, isLlmConfigured, requestDeepSeekJson } = require("./lib/deepseek-summary-client");
const { normalizeText, truncateText } = require("./lib/pipeline");

const ROOT_DIR = path.resolve(__dirname, "..");
const EVENTS_PATH = path.join(ROOT_DIR, "src", "data", "events.json");
const RULES_PATH = path.join(ROOT_DIR, "config", "ai-summary-rules.json");

const IMPACT_KEYS = ["market", "industry", "company", "user_or_developer"];
const TRACKING_DECISIONS = new Set(["值得追踪", "暂时观察", "不值得追踪"]);
const CONFIDENCE_LEVELS = new Set(["高", "中", "低"]);
const RISK_TYPES = new Set([
  "信息风险",
  "市场风险",
  "执行风险",
  "竞争风险",
  "监管风险",
  "商业化风险",
  "成本风险",
  "舆论误读风险"
]);
const EMPTY_EVIDENCE = "目前证据不足";
const QUALITY_THRESHOLD = 80;

function buildEventAnalysisRules(rules = {}) {
  const llm = rules.llmProduction || {};
  return {
    ...rules,
    llmProduction: {
      ...llm,
      requiredSecret: llm.eventRequiredSecret || llm.requiredSecret || "DEEPSEEK_API_KEY",
      maxOutputTokens: Number(llm.eventMaxOutputTokens || llm.maxOutputTokens || 1800)
    }
  };
}

function normalizeList(value, limit = 8) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(normalizeText).filter(Boolean))].slice(0, limit);
}

function normalizeLinks(value, fallbackItems = [], limit = 8) {
  const links = Array.isArray(value) ? value : [];
  const normalized = links.map((entry) => {
    if (typeof entry === "string") return { title: "", url: normalizeText(entry) };
    return {
      title: truncateText(entry?.title || entry?.source || "原文", 120),
      source: truncateText(entry?.source || "", 80),
      url: normalizeText(entry?.url || ""),
      published_at: normalizeText(entry?.published_at || entry?.publishedAt || "")
    };
  }).filter((entry) => entry.url);

  if (!normalized.length) {
    fallbackItems.slice(0, limit).forEach((item) => {
      if (item?.url) {
        normalized.push({
          title: truncateText(item.title || item.source || "原文", 120),
          source: truncateText(item.source || "", 80),
          url: item.url,
          published_at: item.published_at || item.publishedAt || ""
        });
      }
    });
  }

  return normalized.slice(0, limit);
}

function normalizeImpactAnalysis(value, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const legacyUser = source.user || fallback.user;
  return Object.fromEntries(IMPACT_KEYS.map((key) => [
    key,
    truncateText(normalizeText(source[key] || fallback[key] || (key === "user_or_developer" ? legacyUser : "") || EMPTY_EVIDENCE), 260)
  ]));
}

function eventArticles(event = {}) {
  return [
    ...(event.related_articles || []),
    ...(event.evidenceItems || []),
    ...(event.items || [])
  ].filter((item) => item && (item.title || item.url || item.summary));
}

function latestArticleForEvent(event = {}) {
  const latest = event.latestUpdate || {};
  if (latest.title || latest.url || latest.summary) {
    return {
      title: latest.title || "",
      source: latest.source || "",
      source_level: latest.sourceAuthority || latest.sourceTier || "",
      published_at: latest.publishedAt || latest.published_at || "",
      url: latest.url || "",
      content: latest.summary || latest.description || ""
    };
  }
  const article = eventArticles(event)[0] || {};
  return {
    title: article.title || "",
    source: article.source || "",
    source_level: article.sourceAuthority || article.sourceTier || "",
    published_at: article.published_at || article.publishedAt || "",
    url: article.url || "",
    content: article.summary || article.description || ""
  };
}

function buildEventBackground(event = {}) {
  return truncateText(normalizeText([
    event.summary || event.one_sentence_summary,
    event.whyItMatters,
    event.decisionBrief,
    event.marketRelevance
  ].filter(Boolean).join(" ")), 500);
}

function buildPreviousJudgment(event = {}) {
  return truncateText(normalizeText([
    event.decisionBrief,
    event.whyItMatters,
    event.tracking_decision ? `追踪判断：${event.tracking_decision}` : "",
    event.confidence_level ? `置信度：${event.confidence_level}` : ""
  ].filter(Boolean).join(" ")), 500);
}

function normalizeTimelineItem(item = {}) {
  return {
    date: item.date || item.publishedAt || item.published_at || "",
    title: item.title || "",
    summary: item.summary || item.description || "",
    source: item.source || "",
    url: item.url || "",
    evidence_type: item.evidence_type || item.evidenceType || "unknown"
  };
}

function buildEventContext(event = {}) {
  const articles = eventArticles(event);
  return {
    event_id: event.event_id || event.id || "",
    event_title: event.title || "",
    event_background: buildEventBackground(event),
    current_status: event.current_status || "",
    previous_judgment: buildPreviousJudgment(event),
    latest_article: latestArticleForEvent(event),
    related_facts: normalizeList(event.confirmed_facts || event.confirmedFacts, 10),
    previous_timeline: (event.timeline || event.keyDevelopments || []).slice(-12).map(normalizeTimelineItem),
    watch_variables: normalizeList(event.watch_variables || event.watchlist, 10),
    related_articles: normalizeLinks(articles, [], 10),
    existing_uncertainties: normalizeList(event.uncertainties || event.riskFactors, 10),
    existing_analysis_notes: normalizeList((event.analysis_notes || []).map((note) => (
      typeof note === "string" ? note : note.core_change || note.judgment_update || note.title
    )), 10)
  };
}

function buildFactExtractionPrompt(eventContext) {
  return [
    "你是事实提取器。你的任务不是总结文章，也不是做预测，而是从文章和事件上下文中提取可以被来源支持的事实。",
    "要求：",
    "1. 只提取事实，不写预测。",
    "2. 明确区分事实、观点和未经证实的说法。",
    "3. 不允许虚构数据、公司、机构、人物、市场反应。",
    "4. 如果信息不足，必须写明缺失信息。",
    "5. 保留原文来源链接。",
    "6. 输出必须是结构化 JSON。",
    "返回 JSON 结构：",
    "{\"confirmed_facts\":[],\"key_entities\":[],\"time_info\":\"\",\"source_type\":\"\",\"evidence_links\":[],\"new_information\":\"\",\"missing_information\":[],\"possible_opinions\":[],\"unsupported_claims\":[]}",
    "",
    JSON.stringify({ event_context: eventContext }, null, 2)
  ].join("\n");
}

function normalizeFactExtraction(value, eventContext = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Fact extraction response must be a JSON object.");
  }
  const links = normalizeLinks(value.evidence_links, eventContext.related_articles, 8);
  return {
    confirmed_facts: normalizeList(value.confirmed_facts || eventContext.related_facts, 10),
    key_entities: normalizeList(value.key_entities, 10),
    time_info: truncateText(normalizeText(value.time_info || eventContext.latest_article?.published_at || ""), 160),
    source_type: truncateText(normalizeText(value.source_type || eventContext.latest_article?.source_level || "unknown"), 80),
    evidence_links: links,
    new_information: truncateText(normalizeText(value.new_information || "目前无法判断新增信息。"), 260),
    missing_information: normalizeList(value.missing_information, 8),
    possible_opinions: normalizeList(value.possible_opinions, 8),
    unsupported_claims: normalizeList(value.unsupported_claims, 8)
  };
}

function buildFallbackFactExtraction(eventContext = {}) {
  const article = eventContext.latest_article || {};
  return normalizeFactExtraction({
    confirmed_facts: eventContext.related_facts?.length
      ? eventContext.related_facts
      : [article.title, article.content].filter(Boolean),
    key_entities: normalizeList([eventContext.event_title, ...(eventContext.related_articles || []).map((item) => item.source)], 8),
    time_info: article.published_at || "",
    source_type: article.source_level || "unknown",
    evidence_links: eventContext.related_articles || (article.url ? [{ title: article.title, source: article.source, url: article.url }] : []),
    new_information: article.content || eventContext.event_background || "目前无法判断新增信息。",
    missing_information: ["需要更多来源确认后续影响。"],
    possible_opinions: [],
    unsupported_claims: []
  }, eventContext);
}

async function extractFacts(eventContext, rules = {}, options = {}) {
  const responseJson = await requestDeepSeekJson(buildFactExtractionPrompt(eventContext), rules, options);
  return normalizeFactExtraction(responseJson, eventContext);
}

function buildEventAnalysisPrompt(eventContext, factExtraction) {
  return [
    "你是事件分析器，不是文章摘要器。",
    "你的任务是基于事实提取结果、事件背景和历史判断，分析这条信息对整个事件的意义。",
    "必须回答：新信息改变了什么、哪些是已确认事实、影响对象是谁、有哪些前瞻情景、风险、反向观点、观察变量、置信度和是否值得继续追踪。",
    "限制：",
    "1. 不允许虚构来源、数据、公司、机构、市场反应。",
    "2. 不允许把观点当事实。",
    "3. 不允许只复述文章标题。",
    "4. 信息不足时必须明确说明“目前证据不足”。",
    "5. 输出必须是结构化 JSON。",
    "返回 JSON 结构：",
    "{\"core_change\":\"\",\"confirmed_facts\":[],\"impact_analysis\":{\"market\":\"\",\"industry\":\"\",\"company\":\"\",\"user_or_developer\":\"\"},\"forward_looking_scenarios\":[{\"scenario\":\"\",\"condition\":\"\",\"possible_result\":\"\",\"confidence\":\"高 / 中 / 低\"}],\"risk_factors\":[{\"risk\":\"\",\"type\":\"信息风险 / 市场风险 / 执行风险 / 竞争风险 / 监管风险 / 商业化风险 / 成本风险 / 舆论误读风险\",\"reason\":\"\"}],\"counter_arguments\":[],\"watch_variables\":[],\"judgment_update\":\"\",\"tracking_decision\":\"值得追踪 / 暂时观察 / 不值得追踪\",\"confidence_level\":\"高 / 中 / 低\",\"confidence_reason\":\"\",\"source_links\":[]}",
    "",
    JSON.stringify({ event_context: eventContext, fact_extraction: factExtraction }, null, 2)
  ].join("\n");
}

function normalizeScenario(value = {}) {
  return {
    scenario: truncateText(normalizeText(value.scenario), 120),
    condition: truncateText(normalizeText(value.condition), 220),
    possible_result: truncateText(normalizeText(value.possible_result), 260),
    confidence: CONFIDENCE_LEVELS.has(value.confidence) ? value.confidence : "中"
  };
}

function normalizeRisk(value = {}) {
  return {
    risk: truncateText(normalizeText(value.risk), 180),
    type: RISK_TYPES.has(value.type) ? value.type : "信息风险",
    reason: truncateText(normalizeText(value.reason || EMPTY_EVIDENCE), 220)
  };
}

function normalizeEventAnalysis(value, eventContext = {}, factExtraction = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Event analysis response must be a JSON object.");
  }
  const confirmedFacts = normalizeList(value.confirmed_facts || factExtraction.confirmed_facts || eventContext.related_facts, 10);
  const scenarios = (Array.isArray(value.forward_looking_scenarios) ? value.forward_looking_scenarios : [])
    .map(normalizeScenario)
    .filter((item) => item.scenario || item.condition || item.possible_result)
    .slice(0, 5);
  const risks = (Array.isArray(value.risk_factors) ? value.risk_factors : [])
    .map(normalizeRisk)
    .filter((item) => item.risk || item.reason)
    .slice(0, 8);
  const trackingDecision = TRACKING_DECISIONS.has(value.tracking_decision) ? value.tracking_decision : "暂时观察";
  const confidenceLevel = CONFIDENCE_LEVELS.has(value.confidence_level) ? value.confidence_level : "中";
  return {
    core_change: truncateText(normalizeText(value.core_change || value.what_changed || eventContext.previous_judgment || EMPTY_EVIDENCE), 300),
    confirmed_facts: confirmedFacts.length ? confirmedFacts : [EMPTY_EVIDENCE],
    impact_analysis: normalizeImpactAnalysis(value.impact_analysis),
    forward_looking_scenarios: scenarios,
    risk_factors: risks,
    counter_arguments: normalizeList(value.counter_arguments, 6),
    watch_variables: normalizeList(value.watch_variables || eventContext.watch_variables, 8),
    judgment_update: truncateText(normalizeText(value.judgment_update || "信息不足，无法判断"), 220),
    tracking_decision: trackingDecision,
    confidence_level: confidenceLevel,
    confidence_reason: truncateText(normalizeText(value.confidence_reason || EMPTY_EVIDENCE), 260),
    source_links: normalizeLinks(value.source_links, factExtraction.evidence_links || eventContext.related_articles, 8)
  };
}

function fallbackScenarios(eventContext = {}) {
  const watch = eventContext.watch_variables || [];
  return [
    {
      scenario: "后续证据增强",
      condition: watch[0] ? `${watch[0]} 出现明确变化或权威来源继续发布信息。` : "权威来源继续发布可验证信息。",
      possible_result: "事件判断可以从观察转向更明确的跟踪结论。",
      confidence: "中"
    },
    {
      scenario: "后续证据不足",
      condition: "缺少新的官方信息、市场反馈或跨来源验证。",
      possible_result: "当前判断维持观察，不应扩大解释。",
      confidence: "中"
    }
  ];
}

function fallbackRisks(eventContext = {}) {
  return [
    { risk: "来源仍需交叉验证", type: "信息风险", reason: eventContext.related_articles?.length >= 2 ? "已有多个来源，但仍需核对原文细节。" : "相关来源数量有限。" },
    { risk: "市场反应可能被高估", type: "市场风险", reason: "当前材料不足以证明持续市场影响。" },
    { risk: "执行细节可能改变结果", type: "执行风险", reason: "后续政策、产品或企业执行信息仍不完整。" }
  ];
}

function buildFallbackEventAnalysis(eventContext = {}, factExtraction = {}) {
  return normalizeEventAnalysis({
    core_change: factExtraction.new_information || eventContext.previous_judgment || EMPTY_EVIDENCE,
    confirmed_facts: factExtraction.confirmed_facts || eventContext.related_facts,
    impact_analysis: {
      market: EMPTY_EVIDENCE,
      industry: eventContext.event_background || EMPTY_EVIDENCE,
      company: EMPTY_EVIDENCE,
      user_or_developer: EMPTY_EVIDENCE
    },
    forward_looking_scenarios: fallbackScenarios(eventContext),
    risk_factors: fallbackRisks(eventContext),
    counter_arguments: [
      "这条信息可能只是补充材料，并未改变原有判断。",
      "如果缺少后续权威来源或市场反馈，事件影响可能低于表面叙事。"
    ],
    watch_variables: eventContext.watch_variables,
    judgment_update: "暂不改变原有判断",
    tracking_decision: "暂时观察",
    confidence_level: "中",
    confidence_reason: "使用本地规则生成，部分结论依赖现有来源覆盖度。",
    source_links: factExtraction.evidence_links || eventContext.related_articles
  }, eventContext, factExtraction);
}

async function analyzeEventFromFacts(eventContext, factExtraction, rules = {}, options = {}) {
  const responseJson = await requestDeepSeekJson(buildEventAnalysisPrompt(eventContext, factExtraction), rules, options);
  return normalizeEventAnalysis(responseJson, eventContext, factExtraction);
}

function scoreAnalysisQuality(analysis = {}, factExtraction = {}) {
  const flags = [];
  let score = 0;
  if (analysis.core_change && analysis.core_change !== EMPTY_EVIDENCE) score += 15;
  else flags.push("没有说明事件核心变化");
  if ((analysis.confirmed_facts || []).length && (factExtraction.possible_opinions || []).length >= 0) score += 15;
  else flags.push("没有区分事实和推论");
  if (analysis.impact_analysis && IMPACT_KEYS.some((key) => analysis.impact_analysis[key] && analysis.impact_analysis[key] !== EMPTY_EVIDENCE)) score += 15;
  else flags.push("没有影响分析");
  const scenarioCount = (analysis.forward_looking_scenarios || []).length;
  if (scenarioCount >= 2) score += 15;
  else if (scenarioCount > 0) {
    score += 7;
    flags.push("前瞻情景不足");
  } else flags.push("没有前瞻情景");

  const riskCount = (analysis.risk_factors || []).length;
  if (riskCount >= 3) score += 15;
  else if (riskCount > 0) {
    score += 7;
    flags.push("风险因素不足");
  } else flags.push("没有风险因素");

  const counterCount = (analysis.counter_arguments || []).length;
  if (counterCount >= 2) score += 10;
  else if (counterCount > 0) {
    score += 5;
    flags.push("反向观点不足");
  } else flags.push("没有反向观点");

  const watchCount = (analysis.watch_variables || []).length;
  if (watchCount >= 3) score += 10;
  else if (watchCount > 0) {
    score += 5;
    flags.push("后续观察变量不足");
  } else flags.push("没有后续观察变量");
  if (analysis.confidence_reason) score += 5;
  else flags.push("没有置信度说明");

  if (!(analysis.source_links || []).length) flags.push("没有原文链接");
  if (!(analysis.confirmed_facts || []).length) flags.push("没有确认事实");
  if (!(analysis.risk_factors || []).length) flags.push("没有风险因素");
  if (!(analysis.watch_variables || []).length) flags.push("没有观察变量");
  if (!(analysis.counter_arguments || []).length) flags.push("没有反向观点");

  const lowQuality = [
    "没有原文链接",
    "没有确认事实",
    "没有风险因素",
    "没有观察变量",
    "没有反向观点"
  ].some((flag) => flags.includes(flag));
  if (lowQuality) score = Math.min(score, 59);

  return {
    analysis_quality_score: Math.max(0, Math.min(100, score)),
    quality_flags: [...new Set(flags)],
    is_core_analysis: score >= QUALITY_THRESHOLD && !lowQuality
  };
}

function downgradeNonModelQuality(quality = {}, reason = "非模型生成分析") {
  const flags = [...new Set([...(quality.quality_flags || []), reason])];
  return {
    analysis_quality_score: Math.min(quality.analysis_quality_score || 0, QUALITY_THRESHOLD - 1),
    quality_flags: flags,
    is_core_analysis: false
  };
}

function buildAnalysisNote(event, eventContext, factExtraction, analysis, quality, generatedAt, model, status, errorMessage = "") {
  const sourceArticle = eventContext.latest_article || {};
  return {
    id: `${eventContext.event_id || event.id || "event"}-${Date.parse(generatedAt) || Date.now()}`,
    created_at: generatedAt,
    source_article_id: sourceArticle.id || sourceArticle.url || "",
    core_change: analysis.core_change,
    confirmed_facts: analysis.confirmed_facts,
    impact_analysis: analysis.impact_analysis,
    forward_looking_scenarios: analysis.forward_looking_scenarios,
    risk_factors: analysis.risk_factors,
    counter_arguments: analysis.counter_arguments,
    watch_variables: analysis.watch_variables,
    judgment_update: analysis.judgment_update,
    tracking_decision: analysis.tracking_decision,
    confidence_level: analysis.confidence_level,
    confidence_reason: analysis.confidence_reason,
    source_links: analysis.source_links,
    fact_extraction: factExtraction,
    event_context: eventContext,
    analysis_quality_score: quality.analysis_quality_score,
    quality_flags: quality.quality_flags,
    is_core_analysis: quality.is_core_analysis,
    model,
    status,
    ...(errorMessage ? { error: truncateText(errorMessage, 180) } : {})
  };
}

function legacyNotes(notes = []) {
  return (notes || []).filter(Boolean).map((note) => {
    if (typeof note !== "string") return note;
    return {
      id: `legacy-${Math.abs([...note].reduce((hash, char) => hash + char.charCodeAt(0), 0))}`,
      created_at: "",
      core_change: note,
      confirmed_facts: [],
      impact_analysis: normalizeImpactAnalysis({}),
      forward_looking_scenarios: [],
      risk_factors: [],
      counter_arguments: [],
      watch_variables: [],
      judgment_update: "",
      tracking_decision: "暂时观察",
      confidence_level: "低",
      confidence_reason: EMPTY_EVIDENCE,
      source_links: [],
      analysis_quality_score: 0,
      quality_flags: ["历史非结构化记录"],
      is_core_analysis: false
    };
  });
}

function applyEventAnalysis(event, analysisNote, generatedAt, model, status = "succeeded") {
  const coreNote = analysisNote.is_core_analysis ? analysisNote : null;
  const relatedArticles = normalizeLinks(analysisNote.source_links, eventArticles(event), 8).map((link) => ({
    title: link.title,
    source: link.source,
    url: link.url,
    published_at: link.published_at
  }));
  return {
    ...event,
    ...(coreNote ? {
      summary: coreNote.core_change,
      one_sentence_summary: coreNote.core_change,
      decisionBrief: coreNote.judgment_update || coreNote.core_change,
      whyItMatters: coreNote.core_change,
      confirmedFacts: coreNote.confirmed_facts,
      confirmed_facts: coreNote.confirmed_facts,
      impact_analysis: coreNote.impact_analysis,
      uncertainties: coreNote.risk_factors.map((risk) => risk.risk),
      watchlist: coreNote.watch_variables,
      watch_variables: coreNote.watch_variables,
      related_articles: relatedArticles,
      tracking_decision: coreNote.tracking_decision,
      confidence_level: coreNote.confidence_level
    } : {}),
    analysis_notes: [analysisNote, ...legacyNotes(event.analysis_notes)].slice(0, 12),
    llm_analysis: analysisNote,
    llm_analysis_status: status,
    llm_analysis_model: model,
    llm_analysis_generated_at: generatedAt
  };
}

async function analyzeEvent(event, rules = {}, generatedAt = new Date().toISOString(), options = {}) {
  const env = options.env || process.env;
  const model = getLlmConfig(rules, env).model;
  const eventContext = buildEventContext(event);
  let factExtraction;
  try {
    factExtraction = await extractFacts(eventContext, rules, { ...options, env });
  } catch {
    factExtraction = buildFallbackFactExtraction(eventContext);
  }
  const analysis = await analyzeEventFromFacts(eventContext, factExtraction, rules, { ...options, env });
  const quality = scoreAnalysisQuality(analysis, factExtraction);
  const note = buildAnalysisNote(event, eventContext, factExtraction, analysis, quality, generatedAt, model, "succeeded");
  return applyEventAnalysis(event, note, generatedAt, model, "succeeded");
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

  const events = [];
  for (const event of eventsData.events || []) {
    const eventContext = buildEventContext(event);
    if (!configured || eventRules.llmProduction?.enabled === false) {
      const factExtraction = buildFallbackFactExtraction(eventContext);
      const analysis = buildFallbackEventAnalysis(eventContext, factExtraction);
      const quality = downgradeNonModelQuality(scoreAnalysisQuality(analysis, factExtraction), "LLM 未配置，使用本地兜底分析");
      const note = buildAnalysisNote(event, eventContext, factExtraction, analysis, quality, generatedAt, "extractive", "skipped");
      events.push(applyEventAnalysis(event, note, generatedAt, "extractive", "skipped"));
      continue;
    }

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
      const factExtraction = buildFallbackFactExtraction(eventContext);
      const analysis = buildFallbackEventAnalysis(eventContext, factExtraction);
      const quality = downgradeNonModelQuality(scoreAnalysisQuality(analysis, factExtraction), "模型失败后使用本地兜底分析");
      const note = buildAnalysisNote(event, eventContext, factExtraction, analysis, quality, generatedAt, "extractive", "fallback", error.message);
      events.push({
        ...applyEventAnalysis(event, note, generatedAt, "extractive", "fallback"),
        llm_analysis_error: truncateText(error.message || "Event LLM analysis failed.", 180)
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
  analyzeEvent,
  analyzeEventsData,
  analyzeEventFromFacts,
  applyEventAnalysis,
  buildAnalysisNote,
  buildEventAnalysisPrompt,
  buildEventAnalysisRules,
  buildEventContext,
  buildFactExtractionPrompt,
  buildFallbackEventAnalysis,
  buildFallbackFactExtraction,
  extractFacts,
  generateEventAnalysis,
  normalizeEventAnalysis,
  normalizeFactExtraction,
  scoreAnalysisQuality
};
