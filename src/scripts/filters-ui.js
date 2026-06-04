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

  function searchableText(item) {
    return {
      title: normalize(`${item.translatedTitle || ""} ${item.title || ""}`),
      summary: normalize(`${item.summary || ""} ${item.contentExcerpt || ""} ${item.aiSummary || ""} ${item.importance || ""}`),
      source: normalize(item.source),
      labels: normalize(`${(item.impactAreas || []).join(" ")} ${(item.tags || []).join(" ")} ${(item.keywords || []).join(" ")}`)
    };
  }

  function freshnessScore(item) {
    const publishedTime = new Date(item.publishedAt || 0).getTime();
    if (Number.isNaN(publishedTime)) return 0;
    const ageHours = Math.max(0, (Date.now() - publishedTime) / (60 * 60 * 1000));
    return Math.max(0, 20 - Math.min(20, ageHours / 12));
  }

  function getSearchBreakdown(item, terms) {
    const text = searchableText(item);
    const title = terms.reduce((score, term) => score + (text.title.includes(term) ? 1 : 0), 0);
    const keyword = terms.reduce((score, term) => score + (text.labels.includes(term) ? 1 : 0), 0);
    const relevance = terms.reduce((score, term) => score + (text.summary.includes(term) || text.source.includes(term) ? 1 : 0), 0);
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
      const channelMatch = state.channel === "all" || item.category === state.channel;
      const sourceMatch = state.source === "all" || item.source === state.source;
      const keywordMatch = !terms.length || terms.every((term) => combinedText.includes(term));
      const scoreMatch = Number(item.score || 0) >= Number(state.minScore || 0);
      return channelMatch && sourceMatch && keywordMatch && scoreMatch;
    });
    return sortSearchResults(filteredItems, terms) || sortItems(filteredItems, state.sort);
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

    emit();
    return {
      state,
      clearKeyword,
      resetFilters
    };
  }

  window.MessageChooseFilters = {
    applyFilters,
    getFilterResult,
    getSearchBreakdown,
    getSearchScore,
    initFilters
  };
})();
