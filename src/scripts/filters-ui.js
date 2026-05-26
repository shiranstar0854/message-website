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

  function applyFilters(items, state) {
    const keyword = normalize(state.keyword);
    return sortItems(items.filter((item) => {
      const text = normalize(`${item.title} ${item.summary} ${(item.tags || []).join(" ")}`);
      const channelMatch = state.channel === "all" || item.category === state.channel;
      const sourceMatch = state.source === "all" || item.source === state.source;
      const keywordMatch = !keyword || text.includes(keyword);
      const scoreMatch = Number(item.score || 0) >= Number(state.minScore || 0);
      return channelMatch && sourceMatch && keywordMatch && scoreMatch;
    }), state.sort);
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

    channelFilter.innerHTML = channels.map((channel) => `
      <button class="segment-button" type="button" data-channel="${channel.id}" aria-pressed="${channel.id === state.channel}">
        ${channel.label}
      </button>
    `).join("");

    sourceFilter.innerHTML = [
      '<option value="all">全部来源</option>',
      ...uniqueSources(data.items || []).map((source) => `<option value="${source}">${source}</option>`)
    ].join("");

    scoreFilter.value = state.minScore;
    scoreOutput.value = state.minScore;
    sortFilter.value = state.sort;

    function emit() {
      channelFilter.querySelectorAll(".segment-button").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.channel === state.channel));
      });
      scoreOutput.value = state.minScore;
      onChange({ ...state });
    }

    channelFilter.addEventListener("click", (event) => {
      const button = event.target.closest("[data-channel]");
      if (!button) return;
      state.channel = button.dataset.channel;
      emit();
    });

    keywordFilter.addEventListener("input", () => {
      state.keyword = keywordFilter.value;
      emit();
    });

    sourceFilter.addEventListener("change", () => {
      state.source = sourceFilter.value;
      emit();
    });

    scoreFilter.addEventListener("input", () => {
      state.minScore = Number(scoreFilter.value);
      emit();
    });

    sortFilter.addEventListener("change", () => {
      state.sort = sortFilter.value;
      emit();
    });

    clearButton.addEventListener("click", () => {
      state.channel = "all";
      state.keyword = "";
      state.source = "all";
      state.minScore = Number(config.scoreFloor || DEFAULT_STATE.minScore);
      state.sort = config.defaultSort || DEFAULT_STATE.sort;
      keywordFilter.value = "";
      sourceFilter.value = "all";
      scoreFilter.value = state.minScore;
      sortFilter.value = state.sort;
      emit();
    });

    emit();
    return state;
  }

  window.MessageChooseFilters = {
    applyFilters,
    initFilters
  };
})();
