(function () {
  const DEFAULT_STATE = {
    channel: "all",
    keyword: "",
    source: "all",
    minScore: 60,
    sort: "score-desc"
  };

  function normalize(value) {
    return String(value || "").toLowerCase().trim();
  }

  function tokenizeKeyword(value) {
    return normalize(value).split(/\s+/).filter(Boolean);
  }

  const TERM_ALIASES = {
    ai: ["人工智能", "大模型", "生成式ai", "artificial intelligence"],
    人工智能: ["ai", "大模型", "artificial intelligence"],
    芯片: ["chip", "semiconductor", "gpu", "半导体"],
    半导体: ["chip", "semiconductor", "芯片"],
    金融: ["finance", "market", "市场", "监管"],
    宏观: ["macro", "gdp", "inflation", "通胀", "利率", "央行", "美联储"],
    商业: ["business", "company", "earnings", "财报", "企业", "公司"],
    国际: ["global", "world", "international", "外交", "地缘", "制裁"],
    政策: ["policy", "regulation", "监管"],
    监管: ["regulation", "policy", "sec", "csrc", "证监会"]
  };

  const DECISION_TERM_ALIASES = {
    spacex: ["space x", "starship", "starlink", "tsla", "tesla", "elon musk", "musk", "nasa", "faa", "fcc", "\u9a6c\u65af\u514b", "\u7279\u65af\u62c9"],
    "\u9a6c\u65af\u514b": ["elon musk", "musk", "spacex", "starship", "starlink", "tsla", "tesla", "nasa", "faa", "fcc"],
    musk: ["elon musk", "spacex", "starship", "starlink", "tsla", "tesla"],
    tesla: ["tsla", "\u7279\u65af\u62c9", "elon musk", "musk", "spacex"],
    tsla: ["tesla", "\u7279\u65af\u62c9", "elon musk", "spacex"],
    nvidia: ["nvda", "\u82f1\u4f1f\u8fbe", "gpu", "chip", "semiconductor", "smh"],
    nvda: ["nvidia", "\u82f1\u4f1f\u8fbe", "gpu", "chip", "semiconductor", "smh"],
    "\u82f1\u4f1f\u8fbe": ["nvidia", "nvda", "gpu", "chip", "semiconductor", "smh"],
    openai: ["ai", "artificial intelligence", "microsoft", "msft", "\u4eba\u5de5\u667a\u80fd", "\u5927\u6a21\u578b"],
    "\u4eba\u5de5\u667a\u80fd": ["ai", "artificial intelligence", "openai", "nvidia", "nvda", "google", "microsoft"],
    "\u56fd\u52a1\u9662": ["\u4e2d\u56fd\u653f\u5e9c\u7f51", "\u653f\u7b56", "\u843d\u5730"],
    "\u8bc1\u76d1\u4f1a": ["csrc", "sec", "\u76d1\u7ba1", "\u7f8e\u80a1", "\u4e2d\u56fd\u653f\u7b56"],
    "\u4eba\u6c11\u94f6\u884c": ["pbc", "central bank", "\u592e\u884c", "\u653f\u7b56", "\u5229\u7387"],
    "\u53d1\u6539\u59d4": ["ndrc", "\u653f\u7b56", "\u4ea7\u4e1a"],
    "\u8d22\u653f\u90e8": ["mof", "\u653f\u7b56", "\u8d22\u653f"],
    "\u79d1\u6280\u90e8": ["most", "ai", "\u79d1\u6280", "\u4eba\u5de5\u667a\u80fd"],
    "\u5de5\u4fe1\u90e8": ["miit", "ai", "\u7b97\u529b", "\u82af\u7247", "\u4ea7\u4e1a"]
  };

  function expandTerm(term) {
    return [...new Set([term, ...(TERM_ALIASES[term] || []), ...(DECISION_TERM_ALIASES[term] || [])].filter(Boolean).map(normalize))];
  }

  function expandTerms(terms) {
    return terms.map(expandTerm);
  }

  function searchableText(item) {
    const definition = item.definition || {};
    const decision = item.decision || {};
    const evidence = item.evidence || {};
    const profile = item.profile || {};
    const factTexts = (item.confirmed_facts || []).map((fact) => (
      fact && typeof fact === "object" ? fact.fact : fact
    ));
    const riskTexts = (item.risks || []).map((risk) => (
      risk && typeof risk === "object" ? risk.risk : risk
    ));
    const evidenceGaps = evidence.evidence_gaps || [];
    return {
      title: normalize(`${item.title_zh || ""} ${item.titleZh || ""} ${item.translatedTitle || ""} ${item.title_original || ""} ${item.title || ""}`),
      summary: normalize(`${definition.one_sentence || ""} ${definition.why_it_matters || ""} ${item.summary_zh || ""} ${item.summaryZh || ""} ${item.summary_original || ""} ${item.summary || ""} ${item.contentExcerpt || ""} ${item.aiSummary || ""} ${item.importance || ""} ${decision.brief || ""} ${factTexts.join(" ")} ${riskTexts.join(" ")} ${evidenceGaps.join(" ")}`),
      source: normalize(item.source),
      labels: normalize(`${item.category || ""} ${item.primaryCategory || ""} ${item.lane_id || ""} ${item.lane_label || ""} ${decision.signal || ""} ${decision.policy_status || ""} ${(profile.entities ? Object.values(profile.entities).flat() : []).join(" ")} ${(decision.market_symbols || []).join(" ")} ${evidence.confidence_basis || ""} ${(profile.impact_areas || item.impactAreas || []).join(" ")} ${(item.tags || []).join(" ")} ${(item.article_keywords || item.keywords || []).join(" ")}`)
    };
  }

  function freshnessScore(item) {
    const publishedTime = new Date(item.publishedAt || 0).getTime();
    if (Number.isNaN(publishedTime)) return 0;
    const ageHours = Math.max(0, (Date.now() - publishedTime) / (60 * 60 * 1000));
    return Math.max(0, 20 - Math.min(20, ageHours / 12));
  }

  function fieldMatches(field, expandedTerm) {
    return expandedTerm.some((term) => field.includes(term));
  }

  function getSearchBreakdown(item, terms) {
    const text = searchableText(item);
    const expandedTerms = expandTerms(terms);
    const title = expandedTerms.reduce((score, term) => score + (fieldMatches(text.title, term) ? 1 : 0), 0);
    const keyword = expandedTerms.reduce((score, term) => score + (fieldMatches(text.labels, term) ? 1 : 0), 0);
    const relevance = expandedTerms.reduce((score, term) => score + (fieldMatches(text.summary, term) || fieldMatches(text.source, term) ? 1 : 0), 0);
    const authority = ["official-agency", "official-market", "official-media", "financial-media"].includes(item.sourceAuthority) || item.evidence?.official_source_count > 0 ? 1 : 0;
    const market = item.decision?.market_symbols?.length ? 1 : 0;
    return {
      title,
      keyword,
      relevance,
      authority,
      market,
      freshness: freshnessScore(item),
      heat: Number(item.score || 0)
    };
  }

  function getSearchScore(item, terms) {
    if (!terms.length) return 0;
    const score = getSearchBreakdown(item, terms);
    return score.title * 100 + score.keyword * 70 + score.relevance * 35 + score.market * 20 + score.authority * 12 + score.freshness + score.heat / 5;
  }

  function getSearchHitLabels(item, terms) {
    if (!terms.length) return [];
    const breakdown = getSearchBreakdown(item, terms);
    return [
      breakdown.title > 0 ? "标题命中" : "",
      breakdown.keyword > 0 ? "关键词命中" : "",
      breakdown.relevance > 0 ? "摘要/来源命中" : "",
      breakdown.freshness > 0 ? "新近发布" : ""
      , breakdown.market > 0 ? "\u884c\u60c5/\u6807\u7684\u547d\u4e2d" : "",
      breakdown.authority > 0 ? "\u6743\u5a01\u6765\u6e90" : ""
    ].filter(Boolean);
  }

  function uniqueSources(items) {
    return [...new Set(items.map((item) => item.source).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  }

  function sortItems(items, sort) {
    return [...items].sort((left, right) => {
      if (sort === "time-desc") {
        return new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0);
      }
      if (sort === "time-asc") {
        return new Date(left.publishedAt || 0) - new Date(right.publishedAt || 0);
      }
      return Number(right.score || 0) - Number(left.score || 0)
        || new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0);
    });
  }

  function sortSearchResults(items, terms) {
    if (!terms.length) return null;
    return [...items].sort((left, right) => {
      const leftScore = getSearchBreakdown(left, terms);
      const rightScore = getSearchBreakdown(right, terms);
      return rightScore.title - leftScore.title
        || rightScore.keyword - leftScore.keyword
        || rightScore.relevance - leftScore.relevance
        || rightScore.market - leftScore.market
        || rightScore.authority - leftScore.authority
        || rightScore.freshness - leftScore.freshness
        || rightScore.heat - leftScore.heat
        || new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0);
    });
  }

  function applyFilters(items, state) {
    const terms = tokenizeKeyword(state.keyword);
    const filteredItems = items.filter((item) => {
      const text = searchableText(item);
      const combinedText = `${text.title} ${text.summary} ${text.source} ${text.labels}`;
      const expandedTerms = expandTerms(terms);
      const channelMatch = state.channel === "all" || item.category === state.channel;
      const sourceMatch = state.source === "all" || item.source === state.source;
      const keywordMatch = !terms.length || expandedTerms.every((term) => fieldMatches(combinedText, term));
      const scoreMatch = Number(item.score || 0) >= Number(state.minScore || 0);
      return channelMatch && sourceMatch && keywordMatch && scoreMatch;
    });
    const sortedItems = sortSearchResults(filteredItems, terms) || sortItems(filteredItems, state.sort);
    return sortedItems.map((item) => ({
      ...item,
      searchHitLabels: terms.length ? getSearchHitLabels(item, terms) : []
    }));
  }

  function getFilterResult(items, state) {
    const strictItems = applyFilters(items, state);
    const shouldRelaxSource = strictItems.length === 0
      && state.source !== "all"
      && normalize(state.keyword);

    if (!shouldRelaxSource) {
      return {
        items: strictItems,
        isSourceRelaxed: false,
        selectedSource: state.source,
        keyword: state.keyword
      };
    }

    return {
      items: applyFilters(items, { ...state, source: "all" }),
      isSourceRelaxed: true,
      selectedSource: state.source,
      keyword: state.keyword
    };
  }

  function initFilters(config, data, onChange) {
    const state = {
      ...DEFAULT_STATE,
      minScore: Number(config.scoreFloor || DEFAULT_STATE.minScore),
      sort: config.defaultSort || DEFAULT_STATE.sort
    };
    const channelFilter = document.getElementById("channel-filter");
    const keywordFilter = document.getElementById("keyword-filter");
    const sourceFilter = document.getElementById("source-filter");
    const scoreFilter = document.getElementById("score-filter");
    const scoreOutput = document.getElementById("score-output");
    const sortFilter = document.getElementById("sort-filter");
    const clearButton = document.getElementById("clear-filters");
    const channels = [{ id: "all", label: "全部" }, ...(config.channels || [])];

    if (channelFilter) {
      channelFilter.innerHTML = channels.map((channel) => `
        <button class="segment-button" type="button" data-channel="${channel.id}" aria-pressed="${channel.id === state.channel}">
          ${channel.label}
        </button>
      `).join("");
    }

    if (sourceFilter) {
      sourceFilter.innerHTML = [
        '<option value="all">全部来源</option>',
        ...uniqueSources(data.items || []).map((source) => `<option value="${source}">${source}</option>`)
      ].join("");
    }

    if (scoreFilter) scoreFilter.value = state.minScore;
    if (scoreOutput) scoreOutput.value = state.minScore;
    if (sortFilter) sortFilter.value = state.sort;

    function emit() {
      channelFilter?.querySelectorAll(".segment-button").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.channel === state.channel));
      });
      if (scoreOutput) scoreOutput.value = state.minScore;
      onChange({ ...state });
    }

    channelFilter?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-channel]");
      if (!button) return;
      state.channel = button.dataset.channel;
      emit();
    });

    keywordFilter?.addEventListener("input", () => {
      state.keyword = keywordFilter.value;
      emit();
    });

    sourceFilter?.addEventListener("change", () => {
      state.source = sourceFilter.value;
      emit();
    });

    scoreFilter?.addEventListener("input", () => {
      state.minScore = Number(scoreFilter.value);
      emit();
    });

    sortFilter?.addEventListener("change", () => {
      state.sort = sortFilter.value;
      emit();
    });

    clearButton?.addEventListener("click", () => {
      resetFilters();
    });

    function resetFilters() {
      state.channel = "all";
      state.keyword = "";
      state.source = "all";
      state.minScore = Number(config.scoreFloor || DEFAULT_STATE.minScore);
      state.sort = config.defaultSort || DEFAULT_STATE.sort;
      if (keywordFilter) keywordFilter.value = "";
      if (sourceFilter) sourceFilter.value = "all";
      if (scoreFilter) scoreFilter.value = state.minScore;
      if (sortFilter) sortFilter.value = state.sort;
      emit();
    }

    function clearKeyword() {
      state.keyword = "";
      if (keywordFilter) keywordFilter.value = "";
      emit();
    }

    function lowerScoreFloor() {
      state.minScore = 0;
      if (scoreFilter) scoreFilter.value = state.minScore;
      emit();
    }

    function viewAll() {
      state.channel = "all";
      state.keyword = "";
      state.source = "all";
      state.minScore = 0;
      state.sort = "score-desc";
      if (keywordFilter) keywordFilter.value = "";
      if (sourceFilter) sourceFilter.value = "all";
      if (scoreFilter) scoreFilter.value = state.minScore;
      if (sortFilter) sortFilter.value = state.sort;
      emit();
    }

    emit();
    return {
      state,
      clearKeyword,
      resetFilters,
      lowerScoreFloor,
      viewAll
    };
  }

  window.MessageChooseFilters = {
    applyFilters,
    getFilterResult,
    getSearchBreakdown,
    getSearchScore,
    getSearchHitLabels,
    initFilters
  };
})();
