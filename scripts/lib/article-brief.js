const { normalizeText, truncateText } = require("./pipeline");

const ARTICLE_BRIEF_SCHEMA_VERSION = "article-brief.v1";
const STAGES = new Set(["rumor", "proposed", "under_review", "announced", "in_progress", "implemented", "initial_result", "uncertain"]);

function list(value, limit = 6) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((entry) => normalizeText(entry?.text || entry?.variable || entry)).filter(Boolean))].slice(0, limit);
}

function sourceRows(item) {
  const rows = Array.isArray(item.source_links) ? item.source_links : [];
  const normalized = rows.map((source) => ({ name: normalizeText(source.name || source.title || item.source), url: normalizeText(source.url) }))
    .filter((source) => source.name && source.url);
  if (!normalized.length && (item.original_url || item.url)) normalized.push({ name: normalizeText(item.source || "原文"), url: item.original_url || item.url });
  return [...new Map(normalized.map((source) => [source.url, source])).values()].slice(0, 5);
}

function inferStage(item) {
  const text = normalizeText(`${item.title || ""} ${item.what_happened || ""} ${item.summary || ""} ${item.contentExcerpt || ""}`);
  if (/传闻|据悉|rumou?r|reportedly/i.test(text)) return "rumor";
  if (/提议|拟议|计划|proposal|proposed|plans? to/i.test(text)) return "proposed";
  if (/审议|谈判|调查|征求意见|under review|negotiat|investigat|consultation/i.test(text)) return "under_review";
  if (/已实施|已生效|正式施行|implemented|took effect|effective from/i.test(text)) return "implemented";
  if (/开始执行|正在实施|正在推进|in progress|rolling out/i.test(text)) return "in_progress";
  if (/初步结果|数据显示|首次结果|initial result|early result/i.test(text)) return "initial_result";
  if (/发布|宣布|批准|公布|released|announced|approved|published/i.test(text)) return "announced";
  return "uncertain";
}

function normalizeKeyData(values, item) {
  return (Array.isArray(values) ? values : []).map((entry) => {
    if (typeof entry === "string") return { label: "关键数据", value: normalizeText(entry), context: "来自原文或结构化提取。", source_url: item.original_url || item.url || "" };
    return {
      label: normalizeText(entry?.label),
      value: normalizeText(entry?.value),
      context: normalizeText(entry?.context),
      source_url: normalizeText(entry?.source_url || entry?.url)
    };
  }).filter((entry) => entry.value).slice(0, 8);
}

function buildLocalArticleBrief(item) {
  const sources = sourceRows(item);
  const facts = list(item.confirmed_facts?.length ? item.confirmed_facts : item.summary_points, 4);
  const coreSummary = normalizeText(item.what_happened || item.summary_short || item.aiSummary || item.summary_zh || item.contentExcerpt || item.summary || item.title);
  const participants = list([item.classification?.factors?.subject, ...(item.entities || []), item.source], 5);
  const risks = list(item.uncertainties?.length ? item.uncertainties : item.risks, 5);
  const watch = list(item.watch_variables, 5);
  const limitations = [];
  if (!item.background) limitations.push("现有材料未提供足够背景，背景字段留空。");
  if (!item.location) limitations.push("现有材料未明确事件地点。");
  if (!item.stakeholder_positions?.length && !item.possible_opinions?.length) limitations.push("现有材料未提供可核实的多方态度。");
  if (!normalizeKeyData(item.key_data, item).length) limitations.push("现有材料未提供可核实的关键数据。");
  return fitArticleBrief({
    schema_version: ARTICLE_BRIEF_SCHEMA_VERSION,
    title: normalizeText(item.title_zh || item.translatedTitle || item.title),
    core_fact: {
      summary: truncateText([coreSummary, ...facts].filter(Boolean).join(" "), 220),
      participants,
      time: item.publishedAt || "",
      location: normalizeText(item.location || "")
    },
    background: normalizeText(item.background || ""),
    key_data: normalizeKeyData(item.key_data, item),
    current_progress: { stage: inferStage(item), details: truncateText(item.what_happened || coreSummary, 180) },
    impact: {
      direct: truncateText(item.impact || item.why_it_matters || item.importance || "", 220),
      medium_long_term: truncateText(item.medium_long_term_impact || "", 220)
    },
    stakeholder_positions: (item.stakeholder_positions || []).map((entry) => ({ party: normalizeText(entry.party), position: normalizeText(entry.position), evidence: normalizeText(entry.evidence), source_url: normalizeText(entry.source_url || entry.url) })).filter((entry) => entry.party && entry.position).slice(0, 6),
    outlook: watch.length ? `后续发展取决于${watch.join("、")}是否出现可验证变化；在条件满足前，只能视为观察性判断。` : "",
    risks_and_uncertainties: risks,
    watch_variables: watch.map((variable) => ({ variable, confirmation_condition: `出现与“${variable}”相关的正式文件、数据或主体行动。`, invalidation_condition: `后续正式证据与当前判断方向相反，或该变量在预期时间内未发生。` })),
    sources,
    limitations
  });
}

function articleBriefLength(brief) {
  return [
    brief.core_fact?.summary,
    brief.background,
    ...(brief.key_data || []).flatMap((entry) => [entry.label, entry.value, entry.context]),
    brief.current_progress?.details,
    brief.impact?.direct,
    brief.impact?.medium_long_term,
    ...(brief.stakeholder_positions || []).flatMap((entry) => [entry.party, entry.position, entry.evidence]),
    brief.outlook,
    ...(brief.risks_and_uncertainties || []),
    ...(brief.watch_variables || []).flatMap((entry) => [entry.variable, entry.confirmation_condition, entry.invalidation_condition]),
    ...(brief.limitations || [])
  ].map(normalizeText).join("").replace(/\s/g, "").length;
}

function fitArticleBrief(brief) {
  brief.core_fact.summary = truncateText(brief.core_fact.summary, 150);
  brief.background = truncateText(brief.background, 100);
  brief.key_data = brief.key_data.slice(0, 3).map((entry) => ({ ...entry, label: truncateText(entry.label, 24), value: truncateText(entry.value, 36), context: truncateText(entry.context, 70) }));
  brief.current_progress.details = truncateText(brief.current_progress.details, 100);
  brief.impact.direct = truncateText(brief.impact.direct, 110);
  brief.impact.medium_long_term = truncateText(brief.impact.medium_long_term, 90);
  brief.stakeholder_positions = brief.stakeholder_positions.slice(0, 2).map((entry) => ({ ...entry, party: truncateText(entry.party, 24), position: truncateText(entry.position, 70), evidence: truncateText(entry.evidence, 50) }));
  brief.outlook = truncateText(brief.outlook, 90);
  brief.risks_and_uncertainties = brief.risks_and_uncertainties.slice(0, 3).map((entry) => truncateText(entry, 60));
  brief.watch_variables = brief.watch_variables.slice(0, 2).map((entry) => ({ variable: truncateText(entry.variable, 30), confirmation_condition: truncateText(entry.confirmation_condition, 65), invalidation_condition: truncateText(entry.invalidation_condition, 65) }));
  brief.limitations = brief.limitations.slice(0, 6).map((entry) => truncateText(entry, 70));

  const optionalLists = [brief.watch_variables, brief.stakeholder_positions, brief.key_data, brief.risks_and_uncertainties];
  while (articleBriefLength(brief) > 600 && optionalLists.some((rows) => rows.length > 1)) {
    optionalLists.sort((a, b) => b.length - a.length).find((rows) => rows.length > 1).pop();
  }
  if (articleBriefLength(brief) > 600) brief.impact.medium_long_term = truncateText(brief.impact.medium_long_term, 45);
  if (articleBriefLength(brief) > 600) brief.background = truncateText(brief.background, 55);
  if (articleBriefLength(brief) > 600) brief.outlook = truncateText(brief.outlook, 55);
  if (articleBriefLength(brief) > 600) brief.core_fact.summary = truncateText(brief.core_fact.summary, 110);
  if (articleBriefLength(brief) > 600) brief.impact.direct = truncateText(brief.impact.direct, 75);
  if (articleBriefLength(brief) > 600) brief.current_progress.details = truncateText(brief.current_progress.details, 65);
  while (articleBriefLength(brief) > 600 && brief.limitations.length > 1) brief.limitations.pop();

  const evidenceNotes = [
    "本文只使用当前条目的原文、摘要和已记录来源，不补充外部事实。",
    "已确认事实与条件性判断分开表述，尚未发生的结果不视为已经落地。",
    "后续结论需要由正式文件、主体行动或可复核数据继续验证。",
    "若新增材料与当前描述冲突，应以较新的可核实证据修正本摘要。",
    "现有来源覆盖有限，未披露的数据、地点或多方态度保持为空。",
    "材料没有提供可比较基准，因此不推断变化幅度、行业排名或市场规模。",
    "材料没有提供可核实的多方回应，因此不人为制造支持、反对或争议立场。",
    "观察变量只用于后续核验，不代表事件一定会按该方向发展。",
    "摘要中的影响判断均以已披露事实为前提，不能替代后续正式结果。"
  ];
  for (const note of evidenceNotes) {
    if (articleBriefLength(brief) >= 350) break;
    if (!brief.limitations.includes(note)) brief.limitations.push(note);
  }
  return brief;
}

function articleBriefPrompt(item) {
  return [
    "Return valid JSON only. Create a detailed but non-redundant Chinese news brief from the supplied item.",
    "Use only supplied facts, numbers, dates, participants and source URLs. Leave unsupported fields empty and record the gap in limitations.",
    "Distinguish confirmed fact, stakeholder position and conditional inference. Do not describe a proposal or review as implemented.",
    "The combined content fields must contain 350-600 Chinese characters and must not use markdown lists.",
    `current_progress.stage must be one of: ${[...STAGES].join(", ")}.`,
    "Return {article_brief:{schema_version,title,core_fact:{summary,participants,time,location},background,key_data:[{label,value,context,source_url}],current_progress:{stage,details},impact:{direct,medium_long_term},stakeholder_positions:[{party,position,evidence,source_url}],outlook,risks_and_uncertainties,watch_variables:[{variable,confirmation_condition,invalidation_condition}],sources:[{name,url}],limitations:[]}}.",
    JSON.stringify({
      id: item.id,
      title: item.title_zh || item.translatedTitle || item.title,
      original_title: item.title_original || item.title,
      source: item.source,
      published_at: item.publishedAt,
      url: item.original_url || item.url,
      summary: item.summary_zh || item.aiSummary || item.summary,
      body: item.bodyText || item.contentExcerpt,
      confirmed_facts: item.confirmed_facts || [],
      key_data: item.key_data || [],
      why_it_matters: item.why_it_matters || item.importance || "",
      uncertainties: item.uncertainties || item.risks || [],
      watch_variables: item.watch_variables || [],
      classification_factors: item.classification?.factors || {}
    })
  ].join("\n");
}

function validateArticleBrief(value, item) {
  const brief = value?.article_brief || value;
  if (!brief || !normalizeText(brief.title) || !normalizeText(brief.core_fact?.summary)) return null;
  const allowedUrls = new Set(sourceRows(item).map((source) => source.url));
  const inputText = JSON.stringify(item);
  const inputCorpus = normalizeText([
    item.title,
    item.title_zh,
    item.translatedTitle,
    item.summary,
    item.summary_zh,
    item.aiSummary,
    item.contentExcerpt,
    item.bodyText,
    item.source,
    item.publishedAt,
    JSON.stringify(item.confirmed_facts || []),
    JSON.stringify(item.key_data || []),
    JSON.stringify(item.entities || []),
    JSON.stringify(item.classification?.factors || {})
  ].filter(Boolean).join(" ")).toLowerCase();
  const allowedNumbers = new Set(inputText.match(/\b\d+(?:\.\d+)?%?\b/g) || []);
  const contentForNumberValidation = {
    title: brief.title,
    core_fact: brief.core_fact,
    background: brief.background,
    key_data: brief.key_data,
    current_progress: brief.current_progress,
    impact: brief.impact,
    stakeholder_positions: brief.stakeholder_positions,
    outlook: brief.outlook,
    risks_and_uncertainties: brief.risks_and_uncertainties,
    watch_variables: brief.watch_variables
  };
  const outputNumbers = JSON.stringify(contentForNumberValidation).match(/\b\d+(?:\.\d+)?%?\b/g) || [];
  if (outputNumbers.some((number) => !allowedNumbers.has(number))) return null;
  const sources = (brief.sources || []).map((source) => ({ name: normalizeText(source.name), url: normalizeText(source.url) })).filter((source) => source.name && allowedUrls.has(source.url));
  if (!sources.length) return null;
  const participants = list(brief.core_fact.participants, 6);
  const unsupportedParticipant = participants.some((participant) => !inputCorpus.includes(participant.toLowerCase()));
  const time = normalizeText(brief.core_fact.time);
  const location = normalizeText(brief.core_fact.location);
  if (unsupportedParticipant || (time && !inputCorpus.includes(time.toLowerCase())) || (location && !inputCorpus.includes(location.toLowerCase()))) return null;
  const normalized = {
    schema_version: ARTICLE_BRIEF_SCHEMA_VERSION,
    title: truncateText(brief.title, 140),
    core_fact: { summary: normalizeText(brief.core_fact.summary), participants, time, location },
    background: normalizeText(brief.background),
    key_data: normalizeKeyData(brief.key_data, item).filter((entry) => !entry.source_url || allowedUrls.has(entry.source_url)),
    current_progress: { stage: STAGES.has(brief.current_progress?.stage) ? brief.current_progress.stage : "uncertain", details: normalizeText(brief.current_progress?.details) },
    impact: { direct: normalizeText(brief.impact?.direct), medium_long_term: normalizeText(brief.impact?.medium_long_term) },
    stakeholder_positions: (brief.stakeholder_positions || []).map((entry) => ({ party: normalizeText(entry.party), position: normalizeText(entry.position), evidence: normalizeText(entry.evidence), source_url: normalizeText(entry.source_url) })).filter((entry) => entry.party && entry.position && (!entry.source_url || allowedUrls.has(entry.source_url))).slice(0, 6),
    outlook: normalizeText(brief.outlook),
    risks_and_uncertainties: list(brief.risks_and_uncertainties, 6),
    watch_variables: (brief.watch_variables || []).map((entry) => ({ variable: normalizeText(entry.variable), confirmation_condition: normalizeText(entry.confirmation_condition), invalidation_condition: normalizeText(entry.invalidation_condition) })).filter((entry) => entry.variable && entry.confirmation_condition && entry.invalidation_condition).slice(0, 6),
    sources,
    limitations: list(brief.limitations, 8)
  };
  const length = articleBriefLength(normalized);
  if (length < 350 || length > 600) return null;
  return normalized;
}

module.exports = { ARTICLE_BRIEF_SCHEMA_VERSION, STAGES, articleBriefLength, articleBriefPrompt, buildLocalArticleBrief, fitArticleBrief, inferStage, validateArticleBrief };
