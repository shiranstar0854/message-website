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

  function expandTerm(term) {
    return [...new Set([term, ...(TERM_ALIASES[term] || [])].filter(Boolean).map(normalize))];
  }

  function expandTerms(terms) {
    return terms.map(expandTerm);
  }

  function searchableText(item) {
    return {
      title: normalize(`${item.titleZh || ""} ${item.translatedTitle || ""} ${item.title || ""}`),
      summary: normalize(`${item.summaryZh || ""} ${item.summary || ""} ${item.contentExcerpt || ""} ${item.aiSummary || ""} ${item.importance || ""}`),
      source: normalize(item.source),
      labels: normalize(`${item.category || ""} ${item.primaryCategory || ""} ${(item.impactAreas || []).join(" ")} ${(item.tags || []).join(" ")} ${(item.keywords || []).join(" ")}`)
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
    return {
      title,
      keyword,
      relevance,
      freshness: freshnessScore(item),
      heat: Number(item.score || 0)
    };
  }

  function getSearchScore(item, terms) {
    if (!terms.length) return 0;
    const score = getSearchBreakdown(item, terms);
    return score.title * 100 + score.keyword * 70 + score.relevance * 35 + score.freshness + score.heat / 5;
  }

  function getSearchHitLabels(item, terms) {
    if (!terms.length) return [];
    const breakdown = getSearchBreakdown(item, terms);
    return [
      breakdown.title > 0 ? "标题命中" : "",
      breakdown.keyword > 0 ? "关键词命中" : "",
      breakdown.relevance > 0 ? "摘要/来源命中" : "",
      breakdown.freshness > 0 ? "新近发布" : ""
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
