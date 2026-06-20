const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");
const { loadLocalEnv } = require("./lib/load-local-env");
const { extractPublishedKeywords, normalizeText, sortItems, truncateText } = require("./lib/pipeline");
const {
  getLlmConfig,
  isLlmConfigured,
  buildDeepSeekRequestBody,
  extractChatCompletionText,
  requestDeepSeekJson
} = require("./lib/deepseek-summary-client");
const {
  buildStructuredSummaryPrompt,
  buildExtractiveStructuredSummary,
  buildStructuredFieldsFromResponse
} = require("./lib/ai-summarizer");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_CHANNELS = ["tech", "finance", "news"];
const DAILY_BRIEF_SCHEMA_VERSION = "daily-brief.v4";
const DAILY_SUMMARY_SCHEMA_VERSION = DAILY_BRIEF_SCHEMA_VERSION;
const CHANNEL_LABELS = {
  tech: "科技",
  finance: "金融",
  news: "新闻"
};

function detectItemLanguage(item) {
  const text = normalizeText(`${item.title || ""} ${item.contentExcerpt || ""} ${item.summary || ""}`);
  const cjkCount = (text.match(/[\u4e00-\u9fff]/gu) || []).length;
  const latinWords = text.match(/[A-Za-z][A-Za-z'-]{2,}/g) || [];
  if (latinWords.length >= 6 && cjkCount < 6) return "en";
  if (cjkCount >= 6) return "zh";
  return "unknown";
}

function isChineseLanguage(language) {
  const value = normalizeText(language).toLowerCase();
  return value === "zh" || value.startsWith("zh-") || value === "cn" || value === "chinese";
}

function hasChineseText(value) {
  return /[\u4e00-\u9fff]/u.test(String(value || ""));
}

function needsChineseTranslation(item) {
  const explicitLanguage = normalizeText(item.source_language || item.sourceLanguage || "").toLowerCase();
  if (explicitLanguage) return !isChineseLanguage(explicitLanguage);
  return detectItemLanguage(item) !== "zh";
}

function requiredTranslationMaxAttempts(rules = {}, options = {}) {
  const env = options.env || process.env;
  return Math.max(
    1,
    Number(
      options.translationMaxAttempts
        || env.TRANSLATION_MAX_ATTEMPTS
        || rules.llmProduction?.requiredTranslationMaxAttempts
        || rules.llmProduction?.translationMaxAttempts
        || 5
    )
  );
}

function hasRequiredChineseTranslation(item) {
  if (!needsChineseTranslation(item)) return true;
  return Boolean(item.title_zh && item.summary_zh && hasChineseText(`${item.title_zh} ${item.summary_zh}`));
}

function isLikelyEnglishItem(item) {
  return needsChineseTranslation(item);
}

function splitSentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+|(?<=[\u3002\uff01\uff1f])\s*|\n+/u)
    .map((sentence) => normalizeText(sentence))
    .filter(Boolean);
}

function summarizeText(item, maxLength = 180) {
  const sourceText = item.contentExcerpt || item.summary || item.title || "";
  const sentences = splitSentences(sourceText);
  const summary = sentences.find((sentence) => sentence.length >= 24) || sentences[0] || sourceText || item.title;
  return truncateText(summary, maxLength);
}

function buildReason(item, maxLength = 120) {
  const parts = [
    `${item.source || "Unknown source"} / ${item.category || "news"}`,
    `score ${Number(item.score || 0)}`,
    ...(item.tags || []).slice(0, 2)
  ].filter(Boolean);
  return truncateText(parts.join(" · "), maxLength);
}

function buildImportance(item, maxLength = 140) {
  const parts = [
    item.sourceAuthority?.startsWith("official") ? "官方来源" : item.source || "来源",
    `评分 ${Number(item.score || 0)}`,
    item.duplicateCount > 0 ? `合并 ${Number(item.duplicateCount)} 条重复` : "",
    item.timelinessTier ? `更新频率 ${item.timelinessTier}` : ""
  ].filter(Boolean);
  return truncateText(parts.join("；"), maxLength);
}

function buildItemSummaryRules(rules = {}) {
  const llm = rules.llmProduction || {};
  return {
    ...rules,
    llmProduction: {
      ...llm,
      requiredSecret: llm.itemRequiredSecret || llm.aiSummaryRequiredSecret || "DEEPSEEK_API_KEY1"
    }
  };
}

function shouldSummarize(item, rules) {
  return Number(item.score || 0) >= Number(rules.minimumScore || 0)
    && Boolean(item.title)
    && Boolean(item.url);
}

function selectSummaryIds(latestData, dailyRules = {}) {
  const maxItemsPerChannel = Number(dailyRules.maxItemsPerChannel || 20);
  const maxItemsTotal = Number(dailyRules.maxItemsTotal || 0);
  const maxTranslationItems = Number(dailyRules.maxNonChineseTranslationItems || dailyRules.maxEnglishTranslationItems || 30);
  const coverage = dailyRules.summaryCoverage || dailyRules.llmCoverage || "all";
  const selectedIds = new Set();
  const allCandidates = sortItems((latestData.items || []).filter((item) => shouldSummarize(item, dailyRules)));

  if (coverage === "all") {
    (maxItemsTotal > 0 ? allCandidates.slice(0, maxItemsTotal) : allCandidates)
      .forEach((item) => selectedIds.add(item.id));
  } else {
    DEFAULT_CHANNELS.forEach((channel) => {
      sortItems((latestData.items || []).filter((item) => item.category === channel && shouldSummarize(item, dailyRules)))
        .slice(0, maxItemsPerChannel)
        .forEach((item) => selectedIds.add(item.id));
    });
  }

  sortItems((latestData.items || []).filter((item) => (
    needsChineseTranslation(item)
      && Boolean(item.title)
      && Boolean(item.url)
      && Boolean(item.contentExcerpt || item.summary)
      && Number(item.score || 0) >= Number(dailyRules.translateEnglishMinimumScore || 0)
  )))
    .slice(0, maxTranslationItems)
    .forEach((item) => selectedIds.add(item.id));

  return selectedIds;
}

function mergeItemsIntoChannels(latestData, items) {
  return Object.fromEntries(Object.entries(latestData.channels || {}).map(([id, channel]) => {
    const channelItems = (channel.items || []).map((item) => items.find((candidate) => candidate.id === item.id) || item);
    return [id, { ...channel, items: channelItems }];
  }));
}

function composeDisplaySummary(structured = {}, item = {}, limit = 360) {
  const parts = [
    structured.what_happened || structured.summary_short || item.aiSummary || item.summary_zh || item.summary,
    structured.what_changed || structured.why_it_matters,
    structured.impact && structured.impact !== structured.why_it_matters ? structured.impact : "",
    structured.risks ? `需要注意：${structured.risks}` : ""
  ].map(normalizeText).filter(Boolean);
  return truncateText([...new Set(parts)].join(" "), limit);
}

function applyExtractiveSummary(item, rules, generatedAt) {
  const sourceLanguage = detectItemLanguage(item);
  const structured = buildExtractiveStructuredSummary(item, generatedAt, "extractive");
  const displaySummary = composeDisplaySummary(structured, item, rules.summaryMaxLength || 360);
  const summarized = {
    ...item,
    ...structured,
    title_original: item.title_original || item.title,
    summary_original: item.summary_original || item.summary || item.contentExcerpt || "",
    aiSummary: displaySummary || summarizeText(item, rules.summaryMaxLength || 360),
    summaryReason: buildReason(item, rules.reasonMaxLength || 220),
    importance: structured.why_it_matters || buildImportance(item, rules.importanceMaxLength),
    source_language: item.source_language || sourceLanguage,
    sourceLanguage,
    translation_status: item.translation_status || (needsChineseTranslation({ ...item, sourceLanguage }) ? "failed" : "not_required"),
    summaryMethod: "extractive",
    summaryGeneratedAt: generatedAt
  };
  return {
    ...summarized,
    article_keywords: extractPublishedKeywords(summarized),
    keywords: extractPublishedKeywords(summarized)
  };
}

async function applyLlmSummary(item, rules, generatedAt, options = {}) {
  const summary = await requestDeepSeekSummary(item, rules, { ...options, generatedAt });
  const sourceLanguage = detectItemLanguage(item);
  const titleZh = summary.translatedTitle || item.title_zh || item.titleZh || item.translatedTitle;
  const summaryZh = summary.summary_short || summary.aiSummary || item.summary_zh || item.summaryZh;
  const summarized = {
    ...item,
    ...summary,
    title_original: item.title_original || item.title,
    title_zh: titleZh,
    summary_original: item.summary_original || item.summary || item.contentExcerpt || "",
    summary_zh: summaryZh,
    source_language: item.source_language || sourceLanguage,
    sourceLanguage,
    summaryLanguage: "zh",
    translated_at: generatedAt,
    summaryMethod: getLlmConfig(rules).provider,
    summaryGeneratedAt: generatedAt
  };
  summarized.translation_status = hasRequiredChineseTranslation(summarized)
    ? (needsChineseTranslation(summarized) ? "translated" : "not_required")
    : "failed";
  return {
    ...summarized,
    article_keywords: extractPublishedKeywords(summarized),
    keywords: extractPublishedKeywords(summarized)
  };
}

function summarizeLatestData(latestData, rules = {}, generatedAt = new Date().toISOString()) {
  const dailyRules = rules.daily || {};
  const selectedIds = selectSummaryIds(latestData, dailyRules);
  const items = (latestData.items || []).map((item) => (
    selectedIds.has(item.id) ? applyExtractiveSummary(item, dailyRules, generatedAt) : item
  ));
  const channels = mergeItemsIntoChannels(latestData, items);

  return {
    ...latestData,
    generatedAt: latestData.generatedAt || generatedAt,
    summaryGeneratedAt: generatedAt,
    summaryMethod: rules.method || "extractive",
    channels,
    items
  };
}

function buildSummaryPrompt(item, dailyRules = {}) {
  return buildStructuredSummaryPrompt(item, dailyRules);
}

function parseSummaryResponse(responseJson, item, dailyRules = {}) {
  const generatedAt = dailyRules.generatedAt || new Date().toISOString();
  const compatibleResponse = responseJson.summary_short || responseJson.summary_points || responseJson.what_happened || responseJson.confirmed_facts
    ? responseJson
    : {
      summary_short: responseJson.aiSummary || responseJson.summary || "",
      summary_points: responseJson.summaryPoints || [responseJson.aiSummary || responseJson.summary || ""].filter(Boolean),
      key_data: responseJson.keyData || [],
      why_it_matters: responseJson.importance || responseJson.summaryReason || "",
      impact: Array.isArray(responseJson.impactAreas) ? responseJson.impactAreas.join("、") : "",
      risks: responseJson.risks || "不足以判断",
      neutrality_check: responseJson.neutrality_check || responseJson.summaryReason || "仅基于原文信息生成。",
      confidence: responseJson.confidence || "medium"
    };
  const structured = buildStructuredFieldsFromResponse(
    item,
    compatibleResponse,
    generatedAt,
    dailyRules.aiModel || "deepseek"
  );
  const summaryShort = structured.summary_short || summarizeText(item, dailyRules.summaryMaxLength);
  const displaySummary = composeDisplaySummary(structured, item, dailyRules.summaryMaxLength || 360);
  return {
    translatedTitle: truncateText(responseJson.translatedTitle || responseJson.title_zh || responseJson.titleZh || "", 120),
    aiSummary: truncateText(responseJson.aiSummary || displaySummary || structured.what_happened || summaryShort, dailyRules.summaryMaxLength || 360),
    summaryReason: truncateText(responseJson.summaryReason || structured.neutrality_check || buildReason(item, dailyRules.reasonMaxLength || 220), dailyRules.reasonMaxLength || 220),
    importance: truncateText(responseJson.importance || structured.what_changed || structured.why_it_matters || buildImportance(item, dailyRules.importanceMaxLength || 260), dailyRules.importanceMaxLength || 260),
    impactAreas: Array.isArray(responseJson.impactAreas)
      ? responseJson.impactAreas.slice(0, 4).map((value) => truncateText(value, 20)).filter(Boolean)
      : [],
    ...structured
  };
}

async function requestDeepSeekSummary(item, rules = {}, options = {}) {
  const llm = getLlmConfig(rules);
  const dailyRules = {
    ...(rules.daily || {}),
    generatedAt: options.generatedAt || new Date().toISOString(),
    aiModel: llm.model || llm.provider
  };
  const responseJson = await requestDeepSeekJson(buildSummaryPrompt(item, dailyRules), rules, options);
  return parseSummaryResponse(responseJson, item, dailyRules);
}

async function summarizeLatestDataWithLlm(latestData, rules = {}, generatedAt = new Date().toISOString(), options = {}) {
  const dailyRules = rules.daily || {};
  const selectedIds = selectSummaryIds(latestData, dailyRules);
  const env = options.env || process.env;
  const itemSummaryRules = buildItemSummaryRules(rules);
  const llmConfigured = isLlmConfigured(itemSummaryRules, env);
  const stats = {
    llmEnabled: Boolean(itemSummaryRules.llmProduction?.enabled),
    llmConfigured,
    llmAttempted: 0,
    llmSucceeded: 0,
    fallbackCount: 0,
    errorCount: 0
  };
  const errors = [];
  const items = [];

  for (const item of latestData.items || []) {
    if (!selectedIds.has(item.id)) {
      items.push(item);
      continue;
    }

    if (!llmConfigured || !itemSummaryRules.llmProduction?.enabled) {
      stats.fallbackCount += 1;
      items.push(applyExtractiveSummary(item, dailyRules, generatedAt));
      continue;
    }

    stats.llmAttempted += 1;
    const attempts = needsChineseTranslation(item) ? requiredTranslationMaxAttempts(itemSummaryRules, options) : 1;
    let lastError;
    let llmItem;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        llmItem = await applyLlmSummary(item, itemSummaryRules, generatedAt, options);
        if (hasRequiredChineseTranslation(llmItem)) {
          llmItem = { ...llmItem, translation_attempts: attempt };
          break;
        }
        throw new Error("AI summary response did not include required Chinese title and summary.");
      } catch (error) {
        lastError = error;
        llmItem = undefined;
      }
    }

    if (llmItem) {
      stats.llmSucceeded += 1;
      items.push(llmItem);
    } else {
      stats.fallbackCount += 1;
      stats.errorCount += 1;
      errors.push({ id: item.id, message: truncateText(lastError?.message || "AI summary failed.", 180) });
      const fallbackItem = applyExtractiveSummary(item, dailyRules, generatedAt);
      items.push({
        ...fallbackItem,
        translation_status: needsChineseTranslation(item) && !hasRequiredChineseTranslation(item)
          ? "failed"
          : fallbackItem.translation_status
      });
    }
  }

  const channels = mergeItemsIntoChannels(latestData, items);

  return {
    ...latestData,
    generatedAt: latestData.generatedAt || generatedAt,
    summaryGeneratedAt: generatedAt,
    summaryMethod: stats.llmSucceeded > 0 ? getLlmConfig(itemSummaryRules, env).provider : (rules.method || "extractive"),
    summaryStats: stats,
    ...(errors.length ? { summaryErrors: errors.slice(0, 20) } : {}),
    channels,
    items
  };
}

function buildExtractiveChannelSummary(channelId, items, rules = {}) {
  const topItems = sortItems(items).slice(0, Number(rules.daily?.maxHighlightsPerChannel || 5));
  const titles = topItems.map((item) => item.title).filter(Boolean).slice(0, 3);
  const topSources = [...new Set(topItems.map((item) => item.source).filter(Boolean))].slice(0, 3);
  const focus = titles.length
    ? `聚焦点：${titles[0]}`
    : `聚焦点：${CHANNEL_LABELS[channelId] || channelId}暂无足够新内容。`;
  const whyItMatters = topItems.length
    ? `重要性：这些信息来自${topSources.join("、") || "主要来源"}，集中体现本频道最新可观察变化。`
    : "重要性：当前没有足够新内容，暂不形成明确判断。";
  const watchlist = topItems.slice(0, 3).map((item) => `继续关注：${truncateText(item.title, 70)}`);
  const overview = titles.length
    ? `今日${CHANNEL_LABELS[channelId] || channelId}重点集中在：${titles.join("；")}。`
    : `今日${CHANNEL_LABELS[channelId] || channelId}暂无足够高价值信息形成总结。`;

  const summary = {
    id: channelId,
    label: CHANNEL_LABELS[channelId] || channelId,
    overview: truncateText(overview, Number(rules.daily?.channelOverviewMaxLength || 260)),
    focus: truncateText(focus, Number(rules.daily?.focusMaxLength || 140)),
    whyItMatters: truncateText(whyItMatters, Number(rules.daily?.whyItMattersMaxLength || 180)),
    watchlist,
    keyPoints: topItems.slice(0, 3).map((item) => truncateText(item.aiSummary || item.contentExcerpt || item.summary || item.title, 120)),
    highlights: topItems.map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      source: item.source,
      score: item.score,
      summary: truncateText(item.aiSummary || item.contentExcerpt || item.summary || "", 180)
    }))
  };
  return {
    ...summary,
    structured_overview: buildChannelStructuredOverview(summary, topItems)
  };
}

function sourceMix(items = []) {
  const mix = {};
  items.forEach((item) => {
    const key = item.sourceAuthority || item.sourceTier || "unknown";
    mix[key] = (mix[key] || 0) + 1;
  });
  return mix;
}

function buildChannelStructuredOverview(channel = {}, items = []) {
  const sorted = sortItems(items);
  const sources = [...new Set(sorted.map((item) => item.source).filter(Boolean))];
  const qualityFlags = [];
  if (!sorted.length) qualityFlags.push("no_items");
  if (sources.length < 2 && sorted.length > 1) qualityFlags.push("single_source_cluster");
  if (!channel.watchlist?.length) qualityFlags.push("missing_watchlist");
  return {
    schema_version: DAILY_SUMMARY_SCHEMA_VERSION,
    channel_id: channel.id,
    channel_label: channel.label,
    item_count: sorted.length,
    top_item_ids: sorted.slice(0, 5).map((item) => item.id).filter(Boolean),
    source_count: sources.length,
    source_mix: sourceMix(sorted),
    key_signals: (channel.keyPoints || []).slice(0, 5).map((point, index) => ({
      order: index + 1,
      signal: point,
      evidence_item_id: sorted[index]?.id || ""
    })),
    watch_variables: channel.watchlist || [],
    quality: {
      flags: qualityFlags,
      has_highlights: Boolean(channel.highlights?.length),
      has_watchlist: Boolean(channel.watchlist?.length)
    }
  };
}

function buildDailyBriefPrompt(summaryItems, rules = {}) {
  return [
    "Create a deep daily brief for a Chinese event-tracking information system.",
    "Return minified valid JSON only. Do not wrap it in markdown.",
    "Do not include line breaks inside JSON string values.",
    "Use only the provided items. Do not invent facts, sources, market reactions, or event ids.",
    "Return this shape: {\"channels\":[{\"id\":\"tech\",\"thinking_brief\":{\"headline\":\"\",\"surface_summary\":\"\",\"core_judgment\":\"\",\"core_tension\":\"\",\"deep_cause\":\"\",\"why_it_matters\":\"\",\"confidence\":{\"level\":\"高/中/低\",\"reason\":\"\"}},\"key_signals\":[{\"signal_type\":\"\",\"signal\":\"\",\"explanation\":\"\",\"evidence_item_ids\":[],\"source_strength\":\"高/中/低\",\"novelty\":\"新增信息/延续信息\",\"impact_level\":\"高/中/低\"}],\"second_order_effects\":[{\"effect\":\"\",\"logic_chain\":[],\"confidence\":\"高/中/低\"}],\"contrarian_views\":[{\"view\":\"\",\"reason\":\"\",\"what_would_prove_it_wrong\":\"\"}],\"assumptions\":[{\"assumption\":\"\",\"risk_if_wrong\":\"\"}],\"risks\":[{\"risk_type\":\"\",\"risk\":\"\",\"reason\":\"\",\"severity\":\"高/中/低\",\"watch_signal\":\"\",\"evidence_item_ids\":[]}],\"uncertainties\":[{\"uncertainty\":\"\",\"why_it_matters\":\"\",\"needed_evidence\":\"\"}],\"thinking_questions\":[{\"question\":\"\",\"why_this_question_matters\":\"\",\"related_item_ids\":[]}]}]}.",
    "Cover only tech, finance, news. Do not make the brief terse: use analytical Chinese paragraphs.",
    "For each channel, thinking_brief.surface_summary, core_judgment, core_tension, deep_cause, and why_it_matters should each be 80-160 Chinese characters when evidence allows it.",
    "For each key signal, risk, uncertainty, and explanation field, write 1-3 complete analytical sentences instead of short labels.",
    "",
    JSON.stringify({
      channels: DEFAULT_CHANNELS.map((channel) => ({
        id: channel,
        label: CHANNEL_LABELS[channel],
        items: sortItems(summaryItems.filter((item) => item.category === channel)).slice(0, Number(rules.daily?.maxHighlightsPerChannel || 5)).map((item) => ({
          id: item.id,
          title: item.title,
          source: item.source,
          score: item.score,
          summary: item.aiSummary || item.contentExcerpt || item.summary || "",
          publishedAt: item.publishedAt
        }))
      }))
    }, null, 2)
  ].join("\n");
}

function applyDailyBriefResponse(fallbackSummaries, responseJson, rules = {}) {
  const response = Array.isArray(responseJson.channels)
    ? Object.fromEntries(responseJson.channels.map((channel) => [channel.id, channel]))
    : (responseJson.channelSummaries || {});
  return fallbackSummaries.map((channel) => {
    const modelChannel = response[channel.id] || {};
    return {
      ...channel,
      overview: modelChannel.overview || channel.thinking_brief?.surface_summary || "",
      focus: modelChannel.focus || channel.thinking_brief?.core_judgment || "",
      whyItMatters: modelChannel.whyItMatters || channel.thinking_brief?.why_it_matters || "",
      thinking_brief: modelChannel.thinking_brief || {
        ...channel.thinking_brief,
        surface_summary: modelChannel.overview || channel.thinking_brief?.surface_summary || "",
        core_judgment: modelChannel.focus || channel.thinking_brief?.core_judgment || "",
        why_it_matters: modelChannel.whyItMatters || channel.thinking_brief?.why_it_matters || ""
      },
      key_signals: Array.isArray(modelChannel.key_signals) && modelChannel.key_signals.length ? modelChannel.key_signals : channel.key_signals,
      second_order_effects: Array.isArray(modelChannel.second_order_effects) && modelChannel.second_order_effects.length ? modelChannel.second_order_effects : channel.second_order_effects,
      contrarian_views: Array.isArray(modelChannel.contrarian_views) && modelChannel.contrarian_views.length ? modelChannel.contrarian_views : channel.contrarian_views,
      assumptions: Array.isArray(modelChannel.assumptions) && modelChannel.assumptions.length ? modelChannel.assumptions : channel.assumptions,
      risks: Array.isArray(modelChannel.risks) && modelChannel.risks.length ? modelChannel.risks : channel.risks,
      uncertainties: Array.isArray(modelChannel.uncertainties) && modelChannel.uncertainties.length ? modelChannel.uncertainties : channel.uncertainties,
      thinking_questions: Array.isArray(modelChannel.thinking_questions) && modelChannel.thinking_questions.length ? modelChannel.thinking_questions : channel.thinking_questions
    };
  });
}

function ensureStructuredSummaryItem(item = {}, generatedAt = new Date().toISOString()) {
  if (item.structured_summary && item.summary_schema_version) return item;
  const summaryLike = {
    summary_short: item.summary_short || item.aiSummary || item.summary || "",
    what_happened: item.what_happened || item.aiSummary || item.summary_short || item.summary || "",
    what_changed: item.what_changed || item.why_it_matters || item.importance || item.summaryReason || "",
    why_it_matters: item.why_it_matters || item.importance || "",
    confirmed_facts: Array.isArray(item.confirmed_facts) && item.confirmed_facts.length
      ? item.confirmed_facts
      : (Array.isArray(item.summary_points) ? item.summary_points : [item.aiSummary || item.summary_short || item.title].filter(Boolean)),
    key_data: item.key_data || [],
    impact_analysis: item.impact_analysis || {},
    uncertainties: item.uncertainties || (item.risks ? [item.risks] : []),
    watch_variables: item.watch_variables || [],
    tracking_decision: item.tracking_decision || "暂时观察",
    confidence_level: item.confidence_level || "中",
    confidence: item.confidence || "medium",
    neutrality_check: item.neutrality_check || item.summaryReason || "仅基于已抓取内容生成。",
    source_links: item.source_links || [{ title: item.title || item.source || "原文", url: item.original_url || item.url || "" }],
    original_url: item.original_url || item.url || ""
  };
  return {
    ...item,
    ...buildStructuredSummaryCard(item, summaryLike, item.ai_generated_at || generatedAt, item.ai_model || item.summaryMethod || "existing-summary")
  };
}

function buildTimeWindow(nowIso) {
  const date = String(nowIso || new Date().toISOString()).slice(0, 10);
  return {
    start: `${date}T00:00:00.000Z`,
    end: `${date}T23:59:59.000Z`
  };
}

function sourceTypeKey(item = {}) {
  const value = normalizeText(item.sourceAuthority || item.sourceTier || "").toLowerCase();
  if (value.includes("official-agency") || value.includes("official-market")) return "official_agency";
  if (value.includes("official-media")) return "official_media";
  if (value.includes("financial") || value.includes("industry")) return "industry_analysis";
  if (value.includes("social")) return "social_discussion";
  return "media";
}

function sourceIds(items = []) {
  return [...new Set(items.map((item) => item.sourceId || item.source).filter(Boolean))];
}

function buildSourceMix(items = []) {
  const mix = { official_agency: 0, official_media: 0, media: 0, industry_analysis: 0, social_discussion: 0 };
  items.forEach((item) => {
    const key = sourceTypeKey(item);
    mix[key] = (mix[key] || 0) + 1;
  });
  return mix;
}

function textList(values = [], limit = 5) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(normalizeText).filter(Boolean))].slice(0, limit);
}

function itemTitle(item = {}) {
  return item.title_zh || item.translatedTitle || item.title || "";
}

function itemSummary(item = {}) {
  return item.summary_short || item.aiSummary || item.summary_zh || item.summary || item.contentExcerpt || "";
}

function cnConfidence(value) {
  const text = normalizeText(value).toLowerCase();
  if (text === "高" || text === "high") return "高";
  if (text === "低" || text === "low") return "低";
  return "中";
}

function buildDailyBriefItem(item = {}, nowIso = new Date().toISOString()) {
  const facts = textList(item.confirmed_facts?.length ? item.confirmed_facts : item.summary_points, 6);
  const factRows = (facts.length ? facts : [itemSummary(item) || itemTitle(item)].filter(Boolean)).map((text) => ({
    text: truncateText(text, 160),
    evidence_url: item.original_url || item.url || "",
    status: "confirmed"
  }));
  const riskTexts = textList([...(Array.isArray(item.uncertainties) ? item.uncertainties : []), item.risks], 5);
  const watchTexts = textList(item.watch_variables, 5);
  const impact = item.impact_analysis || {};
  const hasCounterArguments = Array.isArray(item.counter_arguments) && item.counter_arguments.length > 0;
  const flags = [];
  if (!factRows.length) flags.push("missing_confirmed_facts");
  if (!(item.original_url || item.url)) flags.push("missing_source_link");
  if (!watchTexts.length) flags.push("missing_watch_variables");
  if (!hasCounterArguments) flags.push("missing_counter_arguments");
  return {
    id: item.id,
    category: item.category || "news",
    title: {
      original: item.title_original || item.title || "",
      translated: item.title_zh || item.translatedTitle || item.title || ""
    },
    url: item.original_url || item.url || "",
    source: {
      id: item.sourceId || item.source || "",
      name: item.source || "",
      level: item.sourceTier || item.sourceAuthority || "",
      type: sourceTypeKey(item)
    },
    published_at: item.publishedAt || item.published_at || nowIso,
    score: Number(item.importance_score || item.score || 0),
    summary: {
      one_sentence: truncateText(item.summary_short || item.aiSummary || itemSummary(item), 180),
      key_points: textList(item.summary_points, 5),
      what_happened: truncateText(item.what_happened || itemSummary(item), 240),
      what_changed: truncateText(item.what_changed || item.why_it_matters || item.importance || "目前证据不足", 240),
      why_it_matters: truncateText(item.why_it_matters || item.importance || item.summaryReason || "目前证据不足", 240)
    },
    facts: factRows,
    opinions: textList(item.possible_opinions, 4).map((text) => ({ text, source: item.source || "", status: "opinion" })),
    unsupported_claims: textList(item.unsupported_claims, 4).map((text) => ({ text, reason: "当前来源中缺少足够证据支撑。" })),
    key_data: textList(item.key_data, 8).map((value) => ({ label: "关键数据", value, context: "来自原文、摘要或结构化提取字段。" })),
    impact: {
      market: impact.market || item.impact || "目前证据不足",
      industry: impact.industry || "目前证据不足",
      company: impact.company || "目前证据不足",
      user_or_developer: impact.user_or_developer || impact.user || "目前证据不足",
      policy_or_regulation: impact.policy_or_regulation || "目前证据不足"
    },
    forward_scenarios: [{
      scenario: "后续证据增强",
      condition: "出现官方公告、市场数据或更多权威来源验证。",
      possible_result: "当前摘要判断可以升级为事件级追踪判断。",
      confidence: "中"
    }],
    risks: (riskTexts.length ? riskTexts : ["后续影响仍需更多证据验证。"]).map((risk) => ({
      risk: truncateText(risk, 180),
      type: "信息风险",
      reason: "当前材料不足以直接确认后续影响。",
      severity: "中"
    })),
    counter_arguments: (hasCounterArguments ? item.counter_arguments : ["该信息可能只是短期报道，尚未形成持续事件。"]).slice(0, 4).map((argument) => ({
      argument: truncateText(argument, 180),
      reason: "需要更多后续证据确认其持续性。"
    })),
    uncertainties: textList(item.uncertainties, 5).map((uncertainty) => ({
      uncertainty,
      needed_evidence: "需要后续官方信息、市场反馈或多来源交叉验证。"
    })),
    watch_variables: watchTexts.map((variable) => ({
      variable,
      why_it_matters: "该变量会影响后续判断是否需要修正。",
      signal_source: "官方公告或后续报道"
    })),
    tracking: {
      decision: item.tracking_decision || "暂时观察",
      related_event_id: item.timeline_event_id || "",
      reason: item.summaryReason || item.why_it_matters || "根据当前重要性与证据质量判断。",
      priority: cnConfidence(item.confidence_level || item.confidence)
    },
    confidence: {
      level: cnConfidence(item.confidence_level || item.confidence),
      reason: item.neutrality_check || item.summaryReason || "基于当前来源质量和信息完整度判断。"
    },
    quality: {
      score: Math.max(0, Math.min(100, Number(item.importance_score || item.score || 0))),
      flags,
      is_structured: true,
      has_confirmed_facts: factRows.length > 0,
      has_source_link: Boolean(item.original_url || item.url),
      has_risks: true,
      has_watch_variables: watchTexts.length > 0,
      has_counter_arguments: hasCounterArguments
    }
  };
}

function buildImpactMap(itemIds = [], confidence = "中") {
  const row = {
    impact: "目前证据不足",
    hidden_risk: "影响仍需后续证据验证。",
    evidence_item_ids: itemIds.slice(0, 2),
    confidence
  };
  return {
    market: { ...row },
    industry: { ...row },
    company: { ...row },
    user_or_developer: { ...row },
    policy_or_regulation: { ...row }
  };
}

function buildDailyBriefChannel(channelId, items, rules = {}, nowIso = new Date().toISOString()) {
  const topItems = sortItems(items).slice(0, Number(rules.daily?.maxHighlightsPerChannel || 5));
  const label = CHANNEL_LABELS[channelId] || channelId;
  const ids = topItems.map((item) => item.id).filter(Boolean);
  const sources = sourceIds(topItems);
  const titles = topItems.map(itemTitle).filter(Boolean).slice(0, 3);
  const signalTexts = topItems.slice(0, 3).map((item) => truncateText(itemSummary(item) || itemTitle(item), 120));
  const confidence = sources.length >= 2 ? "中" : "低";
  const checks = {
    has_core_judgment: topItems.length > 0,
    has_core_tension: topItems.length > 0,
    has_deep_cause: topItems.length > 0,
    has_key_signals: signalTexts.length > 0,
    has_event_links: topItems.some((item) => item.timeline_event_id),
    has_second_order_effects: topItems.length > 0,
    has_contrarian_views: topItems.length > 0,
    has_assumptions: topItems.length > 0,
    has_risks: topItems.length > 0,
    has_watch_variables: topItems.length > 0,
    has_reflection_questions: topItems.length > 0,
    has_source_assessment: topItems.length > 0,
    has_evidence_refs: ids.length > 0
  };
  const flags = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
  return {
    id: channelId,
    label,
    coverage: {
      time_window: buildTimeWindow(nowIso),
      item_count: topItems.length,
      source_count: sources.length,
      source_mix: buildSourceMix(topItems),
      top_item_ids: ids
    },
    thinking_brief: {
      headline: `${label}频道今日核心判断`,
      surface_summary: titles.length ? `今日${label}频道表面变化集中在：${titles.join("；")}。` : `今日${label}频道暂无足够高价值信息。`,
      core_judgment: topItems.length ? `${label}频道需要关注这些信息是否形成持续信号，而不是只看单条新闻热度。` : "目前证据不足，暂不形成频道判断。",
      core_tension: topItems.length ? "当前主要矛盾是短期信息热度与长期可验证影响之间的差距。" : "暂无足够信息形成核心矛盾。",
      deep_cause: topItems.length ? "变化来自政策、市场、产品或机构动作在同一频道内的集中出现。" : "暂无足够信息判断深层原因。",
      why_it_matters: topItems.length ? "这些信息可能影响后续事件追踪优先级和观察变量设置。" : "当前不宜过度解读。",
      confidence: {
        level: confidence,
        reason: sources.length >= 2 ? "该判断基于多个来源，但仍需后续证据验证。" : "来源数量有限，判断仅作观察。"
      }
    },
    key_signals: signalTexts.map((signal, index) => ({
      signal_id: `${channelId}-signal-${String(index + 1).padStart(3, "0")}`,
      signal_type: topItems[index]?.category || channelId,
      signal,
      explanation: "该信号来自高分条目，可能影响频道主线判断。",
      evidence_item_ids: [topItems[index]?.id].filter(Boolean),
      source_strength: confidence,
      novelty: "新增信息",
      impact_level: Number(topItems[index]?.score || 0) >= 85 ? "高" : "中"
    })),
    key_events: topItems.filter((item) => item.timeline_event_id).slice(0, 3).map((item) => ({
      event_id: item.timeline_event_id,
      event_title: itemTitle(item),
      event_status: "持续追踪",
      change_type: "补充证据",
      latest_change: truncateText(itemSummary(item), 160),
      evidence_item_ids: [item.id].filter(Boolean),
      tracking_priority: Number(item.score || 0) >= 85 ? "高" : "中"
    })),
    second_order_effects: [{
      effect: "如果该频道信号持续，可能影响后续事件优先级、市场预期或用户行为。",
      logic_chain: ["高分信息集中出现", "形成可观察频道信号", "进一步影响市场、行业或政策判断"],
      confidence
    }],
    contrarian_views: [{
      view: "这组信息可能被高估。",
      reason: "当前仍可能只是短期信息集中，尚未得到更多后续证据确认。",
      what_would_prove_it_wrong: "出现官方公告、市场数据或多来源后续验证。"
    }],
    assumptions: [{
      assumption: "高分条目代表该频道今日主要变化。",
      risk_if_wrong: "如果评分或来源覆盖偏窄，频道判断可能忽略更重要的低分信息。"
    }],
    impact_map: buildImpactMap(ids, confidence),
    risks: [{
      risk_type: "信息风险",
      risk: "当前频道判断可能受来源覆盖和短期热度影响。",
      reason: "部分影响尚未被官方数据或市场反馈验证。",
      severity: confidence,
      watch_signal: "后续是否出现官方公告、市场价格或更多权威来源。",
      evidence_item_ids: ids.slice(0, 2)
    }],
    uncertainties: [{
      uncertainty: "当前信息是否会发展成持续事件仍不确定。",
      why_it_matters: "这会影响是否需要提高追踪优先级。",
      needed_evidence: "需要后续官方文件、市场数据或多来源报道。"
    }],
    watch_variables: topItems.slice(0, 3).map((item) => ({
      variable: truncateText(itemTitle(item), 90),
      why_it_matters: "后续变化会影响该频道主线判断。",
      signal_source: item.source || "公开来源",
      related_event_id: item.timeline_event_id || ""
    })),
    thinking_questions: [{
      question: "这组信息是在说明真实趋势，还是短期热度？",
      why_this_question_matters: "该问题决定后续应关注长期变量还是只记录短期波动。",
      related_item_ids: ids.slice(0, 2)
    }],
    reflection_prompt: {
      main_question: `这个${label}频道今天最值得继续追问的问题是什么？`,
      follow_up_questions: [
        "有没有官方数据支持这个判断？",
        "市场是否已经提前定价？",
        "谁会真正受益，谁只是被短期带动？",
        "如果这个判断错了，最可能错在哪里？"
      ]
    },
    source_assessment: {
      overall_source_quality: confidence,
      strong_source_ids: sourceIds(topItems.filter((item) => ["official-agency", "official-media", "official-market"].includes(item.sourceAuthority))).slice(0, 5),
      weak_source_ids: sourceIds(topItems.filter((item) => !["official-agency", "official-media", "official-market"].includes(item.sourceAuthority))).slice(0, 5),
      missing_sources: sources.length >= 2 ? [] : ["缺少更多交叉来源", "缺少官方公告或市场数据反馈"],
      source_risk: sources.length >= 2 ? "来源覆盖可用，但仍需后续验证。" : "来源结构偏单一，判断置信度有限。"
    },
    item_refs: {
      highlight_item_ids: ids.slice(0, 3),
      supporting_item_ids: ids.slice(3, 8),
      low_confidence_item_ids: topItems.filter((item) => Number(item.score || 0) < 65).map((item) => item.id).filter(Boolean)
    },
    quality: {
      score: Math.round(Object.values(checks).filter(Boolean).length / Object.keys(checks).length * 100),
      flags,
      checks
    }
  };
}

async function buildDailyChannelSummaries(summaryItems, rules = {}, options = {}) {
  const fallbackSummaries = DEFAULT_CHANNELS.map((channel) => (
    buildDailyBriefChannel(channel, summaryItems.filter((item) => item.category === channel), rules, options.generatedAt)
  ));
  const env = options.env || process.env;
  if (!isLlmConfigured(rules, env)) {
    return {
      channels: fallbackSummaries,
      stats: {
        llmAttempted: 0,
        llmSucceeded: 0,
        fallbackCount: rules.llmProduction?.enabled ? 1 : 0,
        errorCount: 0
      }
    };
  }

  try {
    const maxOutputTokens = Number(
      rules.llmProduction?.dailyBriefMaxOutputTokens
        || Math.max(Number(rules.llmProduction?.maxOutputTokens || 500), 2200)
    );
    const briefRules = {
      ...rules,
      llmProduction: {
        ...(rules.llmProduction || {}),
        maxOutputTokens
      }
    };
    const responseJson = await requestDeepSeekJson(buildDailyBriefPrompt(summaryItems, rules), briefRules, options);
    return {
      channels: applyDailyBriefResponse(fallbackSummaries, responseJson, rules),
      stats: {
        llmAttempted: 1,
        llmSucceeded: 1,
        fallbackCount: 0,
        errorCount: 0
      }
    };
  } catch (error) {
    return {
      channels: fallbackSummaries,
      stats: {
        llmAttempted: 1,
        llmSucceeded: 0,
        fallbackCount: 1,
        errorCount: 1
      },
      errors: [{ message: truncateText(error.message, 180) }]
    };
  }
}

function buildEventCandidates(items = []) {
  const byEvent = new Map();
  sortItems(items).forEach((item) => {
    const eventId = item.timeline_event_id || (Number(item.importance_score || item.score || 0) >= 85 ? `candidate-${item.id}` : "");
    if (!eventId) return;
    if (!byEvent.has(eventId)) {
      byEvent.set(eventId, {
        event_id: eventId,
        title: itemTitle(item),
        category: item.category || "news",
        related_item_ids: [],
        reason: item.why_it_matters || item.importance || item.summaryReason || "该条目分数较高，可能值得进入重点追踪。",
        core_question: "这条信息是否会发展成需要持续追踪的事件？",
        watch_variables: textList(item.watch_variables, 5),
        risks: textList([...(Array.isArray(item.uncertainties) ? item.uncertainties : []), item.risks], 5),
        priority: Number(item.importance_score || item.score || 0) >= 90 ? "高" : "中",
        status: item.timeline_event_id ? "已关联事件" : "待确认"
      });
    }
    byEvent.get(eventId).related_item_ids.push(item.id);
  });
  return [...byEvent.values()].slice(0, 12);
}

async function buildDailySummaryOutput(summarized, rules, nowIso, options = {}) {
  const summaryItems = summarized.items.filter((item) => item.aiSummary);
  const dailyBrief = await buildDailyChannelSummaries(summaryItems, rules, { ...options, generatedAt: nowIso });
  const includeExistingItemStats = options.includeExistingItemStats !== false;
  const itemFallbackCount = includeExistingItemStats ? Number(summarized.summaryStats?.fallbackCount || 0) : 0;
  const itemErrorCount = includeExistingItemStats ? Number(summarized.summaryStats?.errorCount || 0) : 0;
  const briefFallbackCount = Number(dailyBrief.stats?.fallbackCount || 0);
  const briefErrorCount = Number(dailyBrief.stats?.errorCount || 0);
  const llm = getLlmConfig(rules);
  const dailyItems = summaryItems.map((item) => buildDailyBriefItem(item, nowIso));
  const eventCandidates = buildEventCandidates(summaryItems);

  return {
    schema_version: DAILY_BRIEF_SCHEMA_VERSION,
    generated_at: nowIso,
    meta: {
      llm: {
        enabled: Boolean(rules.llmProduction?.enabled),
        provider: llm.provider || "",
        method: llm.provider?.includes("chat") ? "chat-completions" : (llm.provider || summarized.summaryMethod || "extractive"),
        model: llm.model || ""
      },
      stats: {
        channel_count: dailyBrief.channels.length,
        item_count: dailyItems.length,
        event_candidate_count: eventCandidates.length,
        fallback_count: itemFallbackCount + briefFallbackCount,
        error_count: itemErrorCount + briefErrorCount
      }
    },
    channels: dailyBrief.channels,
    items: dailyItems,
    event_candidates: eventCandidates
  };
}

function writeProcessedAiSummaries(output) {
  try {
    writeJson(path.join(ROOT_DIR, "data", "processed", "ai-summaries.json"), output);
  } catch (error) {
    if (error && (error.code === "EPERM" || error.code === "EACCES")) {
      console.warn(`Skipped processed AI summary mirror: ${error.code}`);
      return;
    }
    throw error;
  }
}

async function generateAiSummary(nowIso = new Date().toISOString(), options = {}) {
  const latestPath = path.join(ROOT_DIR, "src", "data", "latest-items.json");
  const rules = readJson(path.join(ROOT_DIR, "config", "ai-summary-rules.json"), {});
  const latest = readJson(latestPath, { items: [], channels: {} });
  const summarized = await summarizeLatestDataWithLlm(latest, rules, nowIso, options);
  const output = await buildDailySummaryOutput(summarized, rules, nowIso, options);

  writeJson(latestPath, summarized);
  writeJson(path.join(ROOT_DIR, "src", "data", "daily-summary.json"), output);
  writeProcessedAiSummaries(output);
  return output;
}

async function generateArticleSummaries(nowIso = new Date().toISOString(), options = {}) {
  const latestPath = path.join(ROOT_DIR, "src", "data", "latest-items.json");
  const rules = readJson(path.join(ROOT_DIR, "config", "ai-summary-rules.json"), {});
  const latest = readJson(latestPath, { items: [], channels: {} });
  const summarized = await summarizeLatestDataWithLlm(latest, rules, nowIso, options);

  writeJson(latestPath, summarized);
  return summarized.summaryStats || {};
}

async function generateDailyBrief(nowIso = new Date().toISOString(), options = {}) {
  const latestPath = path.join(ROOT_DIR, "src", "data", "latest-items.json");
  const rules = readJson(path.join(ROOT_DIR, "config", "ai-summary-rules.json"), {});
  const latest = readJson(latestPath, { items: [], channels: {} });
  const output = await buildDailySummaryOutput(latest, rules, nowIso, { ...options, includeExistingItemStats: false });

  writeJson(path.join(ROOT_DIR, "src", "data", "daily-summary.json"), output);
  writeProcessedAiSummaries(output);
  return output;
}

if (require.main === module) {
  loadLocalEnv(ROOT_DIR);
  const mode = process.argv[2] || "--all";
  const runner = mode === "--items-only"
    ? generateArticleSummaries
    : mode === "--daily-brief-only"
      ? generateDailyBrief
      : generateAiSummary;

  runner()
    .then((output) => {
      if (mode === "--items-only") {
        console.log(`Generated article AI summaries. LLM attempts: ${output.llmAttempted || 0}; succeeded: ${output.llmSucceeded || 0}.`);
        return;
      }
      console.log(`Generated ${output.channels?.length || 0} daily brief channels with ${output.meta?.llm?.method || "unknown"} method.`);
      if (output.meta?.stats?.fallback_count > 0) {
        console.log(`Fallback summaries: ${output.meta.stats.fallback_count}; API errors: ${output.meta.stats.error_count}.`);
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  detectItemLanguage,
  isLikelyEnglishItem,
  needsChineseTranslation,
  hasRequiredChineseTranslation,
  splitSentences,
  summarizeText,
  buildReason,
  buildImportance,
  buildItemSummaryRules,
  getLlmConfig,
  isLlmConfigured,
  buildSummaryPrompt,
  buildDailyBriefPrompt,
  buildDailyBriefChannel,
  buildDailyBriefItem,
  buildEventCandidates,
  buildDeepSeekRequestBody,
  extractChatCompletionText,
  selectSummaryIds,
  parseSummaryResponse,
  requestDeepSeekSummary,
  applyLlmSummary,
  buildDailyChannelSummaries,
  summarizeLatestData,
  summarizeLatestDataWithLlm,
  buildDailySummaryOutput,
  generateAiSummary,
  generateArticleSummaries,
  generateDailyBrief
};
