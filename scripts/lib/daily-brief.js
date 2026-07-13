const { normalizeText, truncateText } = require("./pipeline");

const DAILY_BRIEF_SCHEMA_VERSION = "daily-brief.v6";

function textList(value, limit = 8) {
  const rows = Array.isArray(value) ? value : [value];
  return [...new Set(rows.map((entry) => normalizeText(entry?.text || entry?.variable || entry)).filter(Boolean))].slice(0, limit);
}

function eventTitle(event) {
  return normalizeText(event.title?.translated || event.title_zh || event.translatedTitle || event.title);
}

function eventFact(event) {
  const facts = textList(event.confirmed_facts, 3);
  return truncateText(facts.join(" ") || event.summary || event.what_happened || event.aiSummary || eventTitle(event), 280);
}

function eventSources(events) {
  const rows = events.flatMap((event) => [event.primary_source, ...(event.supporting_sources || [])])
    .map((source) => ({ name: normalizeText(source?.name || source?.source), url: normalizeText(source?.url) }))
    .filter((source) => source.name && source.url);
  return [...new Map(rows.map((source) => [source.url, source])).values()];
}

function dailyBriefLength(brief) {
  return [
    brief.daily_thesis?.headline,
    brief.daily_thesis?.summary,
    ...(brief.core_events || []).flatMap((event) => [event.title, event.core_fact, event.current_progress, event.why_important]),
    ...(brief.key_data || []).flatMap((entry) => [entry.metric, entry.value, entry.comparison, entry.meaning]),
    ...(brief.cross_event_links || []).flatMap((entry) => [...(entry.logic_chain || []), entry.interpretation]),
    brief.main_impacts?.short_term,
    brief.main_impacts?.medium_long_term,
    ...(brief.main_impacts?.affected_groups || []),
    ...(brief.risk_alerts || []).flatMap((entry) => [entry.risk, entry.basis, entry.uncertainty]),
    ...(brief.follow_up_watch || []).flatMap((entry) => [entry.variable, entry.time_window, entry.confirmation_condition, entry.invalidation_condition, ...(entry.evidence_needed || [])]),
    ...(brief.tomorrow_focus || []).flatMap((entry) => [entry.item, entry.expected_time, entry.why_it_matters]),
    ...(brief.limitations || [])
  ].map(normalizeText).join("").replace(/\s/g, "").length;
}

function fitDailyBrief(brief) {
  const count = Math.max(1, brief.core_events.length);
  const caps = count >= 5 ? [45, 60, 35, 45] : count === 4 ? [50, 75, 40, 50] : [55, 90, 45, 60];
  brief.daily_thesis.headline = truncateText(brief.daily_thesis.headline, 60);
  brief.daily_thesis.summary = truncateText(brief.daily_thesis.summary, 120);
  brief.core_events = brief.core_events.map((event) => ({ ...event, title: truncateText(event.title, caps[0]), core_fact: truncateText(event.core_fact, caps[1]), current_progress: truncateText(event.current_progress, caps[2]), why_important: truncateText(event.why_important, caps[3]) }));
  brief.key_data = brief.key_data.slice(0, 3).map((entry) => ({ ...entry, metric: truncateText(entry.metric, 24), value: truncateText(entry.value, 30), comparison: truncateText(entry.comparison, 45), meaning: truncateText(entry.meaning, 55) }));
  brief.cross_event_links = brief.cross_event_links.slice(0, 1).map((entry) => ({ ...entry, logic_chain: (entry.logic_chain || []).slice(0, 3).map((value) => truncateText(value, 24)), interpretation: truncateText(entry.interpretation, 70) }));
  brief.main_impacts.short_term = truncateText(brief.main_impacts.short_term, 65);
  brief.main_impacts.medium_long_term = truncateText(brief.main_impacts.medium_long_term, 65);
  brief.main_impacts.affected_groups = brief.main_impacts.affected_groups.slice(0, 4).map((value) => truncateText(value, 20));
  brief.risk_alerts = brief.risk_alerts.slice(0, 1).map((entry) => ({ risk: truncateText(entry.risk, 45), basis: truncateText(entry.basis, 55), uncertainty: truncateText(entry.uncertainty, 45) }));
  brief.follow_up_watch = brief.follow_up_watch.slice(0, 1).map((entry) => ({ ...entry, variable: truncateText(entry.variable, 30), time_window: truncateText(entry.time_window, 18), confirmation_condition: truncateText(entry.confirmation_condition, 50), invalidation_condition: truncateText(entry.invalidation_condition, 50), evidence_needed: entry.evidence_needed.slice(0, 2).map((value) => truncateText(value, 22)) }));
  brief.tomorrow_focus = brief.tomorrow_focus.slice(0, 2).map((entry) => ({ item: truncateText(entry.item, 35), expected_time: truncateText(entry.expected_time, 24), why_it_matters: truncateText(entry.why_it_matters, 55) }));
  brief.limitations = brief.limitations.slice(0, 5).map((value) => truncateText(value, 65));

  if (dailyBriefLength(brief) > 1200) brief.tomorrow_focus = [];
  if (dailyBriefLength(brief) > 1200) brief.key_data = [];
  if (dailyBriefLength(brief) > 1200) brief.main_impacts.affected_groups = [];
  if (dailyBriefLength(brief) > 1200) brief.main_impacts.medium_long_term = truncateText(brief.main_impacts.medium_long_term, 35);
  if (dailyBriefLength(brief) > 1200) brief.cross_event_links = brief.cross_event_links.map((entry) => ({ ...entry, logic_chain: entry.logic_chain.map((value) => truncateText(value, 16)), interpretation: truncateText(entry.interpretation, 45) }));
  if (dailyBriefLength(brief) > 1200) brief.core_events = brief.core_events.map((event) => ({ ...event, core_fact: truncateText(event.core_fact, 55), why_important: truncateText(event.why_important, 40) }));
  return brief;
}

function eventProgress(event) {
  const stage = normalizeText(event.current_progress?.stage || event.stage || "uncertain");
  const details = normalizeText(event.current_progress?.details || event.progress || "");
  const labels = {
    rumor: "仍属传闻，尚未得到正式确认",
    proposed: "目前处于提议或计划阶段，尚未进入执行",
    under_review: "目前处于审议、谈判或调查阶段",
    announced: "相关主体已经正式公布，但执行结果仍待观察",
    in_progress: "相关安排已经进入执行或推进阶段",
    implemented: "相关安排已经实施",
    initial_result: "已经出现初步结果，但仍需更多数据确认",
    uncertain: "现有事件材料没有明确标注实施阶段"
  };
  return truncateText(details || labels[stage] || labels.uncertain, 150);
}

function buildLocalDailyBrief(events, nowIso = new Date().toISOString()) {
  const selected = [...events].sort((a, b) => Number(b.importance_score || 0) - Number(a.importance_score || 0)).slice(0, 5);
  const categories = [...new Set(selected.map((event) => event.category).filter(Boolean))].slice(0, 3);
  const sources = eventSources(selected);
  const coreEvents = selected.map((event) => ({
    event_id: event.event_id || event.id,
    title: eventTitle(event),
    core_fact: eventFact(event),
    current_progress: eventProgress(event),
    why_important: truncateText(event.why_it_matters || event.importance || "该事件包含新的可验证事实，其后续执行和独立证据可能改变相关主体的判断。", 180)
  }));
  const keyData = selected.flatMap((event) => (event.key_data || []).map((entry) => ({
    metric: normalizeText(entry.metric || entry.label),
    value: normalizeText(entry.value),
    comparison: normalizeText(entry.comparison || entry.baseline),
    meaning: normalizeText(entry.meaning || entry.context),
    source_url: normalizeText(entry.source_url || event.primary_source?.url)
  }))).filter((entry) => entry.metric && entry.value && entry.comparison && entry.meaning).slice(0, 8);
  const links = selected.length >= 2 ? [{
    related_event_ids: selected.slice(0, 3).map((event) => event.event_id || event.id),
    logic_chain: selected.slice(0, 3).map((event) => `${eventTitle(event)}提供了一项独立的当日信号`),
    interpretation: `这些事件不能仅因同日出现就视为因果关系；它们共同反映${categories.length ? categories.join("、") : "多个领域"}的政策、经营或市场信号正在并行变化，后续需要用执行结果和新增数据判断是否形成同一主线。`
  }] : [];
  const watch = selected.flatMap((event) => (event.watch_variables || []).map((entry) => {
    const variable = normalizeText(entry.variable || entry.name || entry);
    return {
      variable,
      time_window: normalizeText(entry.time_window || "未来7天"),
      confirmation_condition: normalizeText(entry.confirmation_condition || `出现与“${variable}”直接相关的正式文件、数据或主体行动`),
      invalidation_condition: normalizeText(entry.invalidation_condition || `正式证据与当前判断方向相反，或该变量在观察期内没有发生`),
      evidence_needed: textList(entry.evidence_needed?.length ? entry.evidence_needed : ["正式文件或原始数据", "独立来源交叉验证"], 4)
    };
  })).filter((entry) => entry.variable).slice(0, 8);
  const explicitSchedule = watch.filter((entry) => /\d{4}[-年/]\d{1,2}|\d{1,2}月\d{1,2}日|明日|下周[一二三四五六日]/.test(`${entry.time_window} ${entry.variable}`));
  const limitations = [];
  if (selected.length < 3) limitations.push("当日高价值事件少于3项，未通过重复内容补足数量。");
  if (!keyData.length) limitations.push("事件材料缺少同时具备比较基准和明确含义的关键数据，因此关键数据字段留空。");
  if (!watch.length) limitations.push("事件材料没有提供可验证的后续变量，因此后续观察字段留空。");
  if (!explicitSchedule.length) limitations.push("现有材料没有可靠的明确日程，因此明日关注字段留空。");
  const headline = selected.length
    ? `${categories.length ? categories.join("、") : "今日信息"}的关键变化与验证条件`
    : "当日有效事件样本不足";
  const summary = selected.length
    ? `今日筛选出的${selected.length}项核心事件显示，信息价值主要来自已经公开的事实、正式表态与可继续验证的执行线索。当前可以确认的是事件本身及其已公布进度；事件之间的共同趋势仍属于条件性判断，不能把同日出现直接解释为因果关系。`
    : "当日内部事件档案没有足够样本，无法形成可靠主线。";
  const brief = {
    schema_version: DAILY_BRIEF_SCHEMA_VERSION,
    date: nowIso.slice(0, 10),
    updated_at: nowIso,
    daily_thesis: { headline, summary },
    core_events: coreEvents,
    key_data: keyData,
    cross_event_links: links,
    main_impacts: {
      short_term: selected.length ? "短期影响首先取决于相关主体是否把公开表态转化为执行动作，以及市场、行业或政策部门是否出现可观察反馈。现阶段不把尚未发生的结果写成确定事实。" : "",
      medium_long_term: selected.length ? "中长期方向需要由后续正式文件、连续数据和独立来源共同确认。若这些证据持续支持当前方向，相关政策、行业或经营判断才可能形成稳定趋势；若出现反向证据，应及时修正结论。" : "",
      affected_groups: [...new Set(selected.flatMap((event) => event.entities || []).map(normalizeText).filter(Boolean))].slice(0, 8)
    },
    risk_alerts: selected.slice(0, 4).map((event) => ({
      risk: `${eventTitle(event)}的后续结果仍存在不确定性`,
      basis: truncateText((event.evidence_gaps || []).map((gap) => gap.gap || gap).filter(Boolean).join("；") || "当前证据主要覆盖已公布事实，尚未覆盖完整执行结果。", 160),
      uncertainty: "新增正式材料、执行变化或来源冲突都可能改变当前判断。"
    })),
    follow_up_watch: watch,
    tomorrow_focus: explicitSchedule.slice(0, 4).map((entry) => ({ item: entry.variable, expected_time: entry.time_window, why_it_matters: "该进展可用于检验当前判断是否继续成立。" })),
    sources,
    limitations
  };
  fitDailyBrief(brief);
  if (dailyBriefLength(brief) < 700) brief.limitations.push("可用事件事实不足以达到目标篇幅，未使用无来源内容补足字数。");
  return brief;
}

function buildDailyBriefPrompt(events, nowIso) {
  return [
    "Return strict valid JSON only. Write a Chinese daily analytical brief from the supplied internal events.",
    "Use 3-5 events and 700-1200 Chinese characters across content fields. Form a daily thesis and evidence-bound links instead of reciting news items.",
    "Use only supplied event IDs, facts, numbers, dates, participants and source URLs. Do not treat chronology as causality.",
    "Every key_data row requires comparison and meaning. tomorrow_focus requires an explicit verifiable date or scheduled progress; otherwise return an empty array.",
    "Return exactly the daily-brief.v6 shape: {schema_version,date,updated_at,daily_thesis:{headline,summary},core_events:[{event_id,title,core_fact,current_progress,why_important}],key_data:[{metric,value,comparison,meaning,source_url}],cross_event_links:[{related_event_ids,logic_chain,interpretation}],main_impacts:{short_term,medium_long_term,affected_groups},risk_alerts:[{risk,basis,uncertainty}],follow_up_watch:[{variable,time_window,confirmation_condition,invalidation_condition,evidence_needed}],tomorrow_focus:[{item,expected_time,why_it_matters}],sources:[{name,url}],limitations:[]}.",
    JSON.stringify({ date: nowIso.slice(0, 10), events: events.slice(0, 5) })
  ].join("\n");
}

function validateDailyBrief(value, events, nowIso) {
  if (!value || !value.daily_thesis || !Array.isArray(value.core_events)) return null;
  const selected = events.slice(0, 5);
  const allowedIds = new Set(selected.map((event) => event.event_id || event.id));
  const allowedUrls = new Set(eventSources(selected).map((source) => source.url));
  const inputNumbers = new Set(JSON.stringify(selected).match(/\b\d+(?:\.\d+)?%?\b/g) || []);
  nowIso.slice(0, 10).split("-").forEach((part) => inputNumbers.add(String(Number(part))));
  const coreEvents = value.core_events.map((event) => ({
    event_id: normalizeText(event.event_id), title: normalizeText(event.title), core_fact: normalizeText(event.core_fact),
    current_progress: normalizeText(event.current_progress), why_important: normalizeText(event.why_important)
  })).filter((event) => allowedIds.has(event.event_id) && event.title && event.core_fact && event.current_progress && event.why_important);
  if (coreEvents.length < 3 || coreEvents.length > 5) return null;
  const keyData = (value.key_data || []).map((entry) => ({ metric: normalizeText(entry.metric), value: normalizeText(entry.value), comparison: normalizeText(entry.comparison), meaning: normalizeText(entry.meaning), source_url: normalizeText(entry.source_url) }))
    .filter((entry) => entry.metric && entry.value && entry.comparison && entry.meaning && allowedUrls.has(entry.source_url));
  const sources = (value.sources || []).map((source) => ({ name: normalizeText(source.name), url: normalizeText(source.url) })).filter((source) => source.name && allowedUrls.has(source.url));
  if (!sources.length) return null;
  const normalized = {
    schema_version: DAILY_BRIEF_SCHEMA_VERSION,
    date: nowIso.slice(0, 10), updated_at: nowIso,
    daily_thesis: { headline: normalizeText(value.daily_thesis.headline), summary: normalizeText(value.daily_thesis.summary) },
    core_events: coreEvents,
    key_data: keyData,
    cross_event_links: (value.cross_event_links || []).map((entry) => ({ related_event_ids: textList(entry.related_event_ids, 5).filter((id) => allowedIds.has(id)), logic_chain: textList(entry.logic_chain, 6), interpretation: normalizeText(entry.interpretation) })).filter((entry) => entry.related_event_ids.length >= 2 && entry.logic_chain.length && entry.interpretation),
    main_impacts: { short_term: normalizeText(value.main_impacts?.short_term), medium_long_term: normalizeText(value.main_impacts?.medium_long_term), affected_groups: textList(value.main_impacts?.affected_groups, 10) },
    risk_alerts: (value.risk_alerts || []).map((entry) => ({ risk: normalizeText(entry.risk), basis: normalizeText(entry.basis), uncertainty: normalizeText(entry.uncertainty) })).filter((entry) => entry.risk && entry.basis && entry.uncertainty).slice(0, 8),
    follow_up_watch: (value.follow_up_watch || []).map((entry) => ({ variable: normalizeText(entry.variable), time_window: normalizeText(entry.time_window), confirmation_condition: normalizeText(entry.confirmation_condition), invalidation_condition: normalizeText(entry.invalidation_condition), evidence_needed: textList(entry.evidence_needed, 5) })).filter((entry) => entry.variable && entry.time_window && entry.confirmation_condition && entry.invalidation_condition),
    tomorrow_focus: (value.tomorrow_focus || []).map((entry) => ({ item: normalizeText(entry.item), expected_time: normalizeText(entry.expected_time), why_it_matters: normalizeText(entry.why_it_matters) })).filter((entry) => entry.item && entry.why_it_matters && /\d{4}[-年/]\d{1,2}|\d{1,2}月\d{1,2}日|明日|下周[一二三四五六日]/.test(entry.expected_time)),
    sources,
    limitations: textList(value.limitations, 8)
  };
  if (!normalized.daily_thesis.headline || !normalized.daily_thesis.summary) return null;
  const outputNumbers = JSON.stringify({ ...normalized, schema_version: "", date: "", updated_at: "" }).match(/\b\d+(?:\.\d+)?%?\b/g) || [];
  if (outputNumbers.some((number) => !inputNumbers.has(number))) return null;
  const length = dailyBriefLength(normalized);
  return length >= 700 && length <= 1200 ? normalized : null;
}

module.exports = { DAILY_BRIEF_SCHEMA_VERSION, buildDailyBriefPrompt, buildLocalDailyBrief, dailyBriefLength, eventSources, fitDailyBrief, validateDailyBrief };
