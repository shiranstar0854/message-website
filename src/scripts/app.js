(function () {
  const FALLBACK_CONFIG = {
    siteName: "Message Choose",
    tagline: "科技、金融、新闻信息筛选台",
    defaultLimit: 8,
    defaultSort: "score-desc",
    scoreFloor: 60,
    channels: [
      { id: "tech", label: "科技", description: "AI、云计算、芯片、开发者平台与安全基础设施。" },
      { id: "finance", label: "金融", description: "央行、监管、市场结构、宏观数据与风险信号。" },
      { id: "news", label: "新闻", description: "公共政策、国际事件、社会治理与重大突发消息。" }
    ]
  };

  const FALLBACK_DATA = {
    siteName: "Message Choose",
    generatedAt: "",
    totalItems: 0,
    channels: {
      tech: { label: "科技", count: 0, items: [] },
      finance: { label: "金融", count: 0, items: [] },
      news: { label: "新闻", count: 0, items: [] }
    },
    items: []
  };

  const FALLBACK_HEALTH = {
    sources: [
      { name: "TechCrunch", category: "tech", status: "healthy", failureCount: 0 },
      { name: "Federal Reserve", category: "finance", status: "healthy", failureCount: 0 },
      { name: "BBC World", category: "news", status: "healthy", failureCount: 0 }
    ]
  };

  const FALLBACK_DAILY = {
    generatedAt: "",
    channelSummaries: []
  };

  async function loadJson(url, fallback) {
    if (window.location.protocol === "file:") return fallback;

    try {
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch {
      return fallback;
    }
  }

  function formatGeneratedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "数据时间未知";
    return `信息流更新 ${new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date)}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateSummary(data, displayedCount, filteredCount, message = "") {
    document.getElementById("generated-at").textContent = formatGeneratedAt(data.generatedAt);
    document.getElementById("total-count").textContent = `${filteredCount} 条`;
    document.getElementById("result-summary").textContent = message
      || `信息流更新时间：${formatGeneratedAt(data.generatedAt).replace("信息流更新 ", "")}；当前显示 ${displayedCount} / ${filteredCount} 条，数据池 ${data.totalItems || data.items.length} 条。`;
  }

  function formatShortDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function renderDailyFocus(daily, data, health) {
    const meta = document.getElementById("daily-focus-meta");
    const grid = document.getElementById("daily-focus-grid");
    if (!meta || !grid) return;

    const sources = health.sources || [];
    const healthy = sources.filter((source) => source.status === "healthy").length;
    const empty = sources.filter((source) => source.status === "empty").length;
    const abnormal = sources.filter((source) => source.status === "failed").length;
    const summaries = daily.channelSummaries || [];
    meta.textContent = `摘要更新 ${formatShortDate(daily.generatedAt || data.generatedAt)}；有新内容来源 ${healthy} 个，暂无48小时内新内容 ${empty} 个，抓取失败 ${abnormal} 个。`;

    if (!summaries.length) {
      grid.innerHTML = `
        <article class="focus-card"><strong>科技</strong><p>暂无摘要，信息流更新后会显示本频道重点。</p></article>
        <article class="focus-card"><strong>金融</strong><p>暂无摘要，信息流更新后会显示本频道重点。</p></article>
        <article class="focus-card"><strong>新闻</strong><p>暂无摘要，信息流更新后会显示本频道重点。</p></article>
      `;
      return;
    }

    grid.innerHTML = summaries.slice(0, 3).map((channel) => `
      <article class="focus-card">
        <strong>${escapeHtml(channel.label || channel.id)}</strong>
        <p>${escapeHtml(channel.overview || "")}</p>
        ${(channel.keyPoints || []).length ? `
          <ul>
            ${(channel.keyPoints || []).slice(0, 3).map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
          </ul>
        ` : ""}
      </article>
    `).join("");
  }

  function channelLabel(data, category) {
    return data.channels?.[category]?.label || category || "新闻";
  }

  function selectTopHotspots(items) {
    return [...(items || [])]
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0)
        || new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime())
      .slice(0, 5);
  }

  function renderTopHotspots(data) {
    const container = document.getElementById("top-hotspot-list");
    if (!container) return;

    const items = selectTopHotspots(data.items || []);
    if (!items.length) return;

    container.innerHTML = items.map((item, index) => {
      const safeUrl = window.MessageChooseRender.safeExternalUrl(item.url);
      const title = safeUrl
        ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>`
        : escapeHtml(item.title);
      return `
        <article class="top-hotspot-card${index === 0 ? " is-primary" : ""}">
          <div class="top-hotspot-rank">Top ${index + 1}</div>
          <div class="top-hotspot-body">
            <h3>${title}</h3>
            <p>${escapeHtml(item.aiSummary || item.contentExcerpt || item.summary || "暂无摘要。")}</p>
            <div class="top-hotspot-meta">
              <span>${escapeHtml(item.source)}</span>
              <span>${escapeHtml(channelLabel(data, item.category))}</span>
              <span>${escapeHtml(formatShortDate(item.publishedAt))}</span>
              <strong>${Number(item.score || 0)}</strong>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  async function init() {
    const [config, data, health, daily] = await Promise.all([
      loadJson("public/site-config.json", FALLBACK_CONFIG),
      loadJson("src/data/latest-items.json", FALLBACK_DATA),
      loadJson("src/data/source-health.json", FALLBACK_HEALTH),
      loadJson("src/data/daily-summary.json", FALLBACK_DAILY)
    ]);

    const feed = document.getElementById("feed");
    const summary = document.getElementById("channel-summary");
    const sourceDisclosure = document.getElementById("source-disclosure");
    const sourceSummary = document.getElementById("source-summary");
    const sourceStatus = document.getElementById("source-status");
    const sourceToggle = document.getElementById("source-toggle");
    const loadMoreButton = document.getElementById("load-more");
    const pageSize = Number(data.defaultLimit || config.defaultLimit || 8);
    let activeState = null;
    let filterControls = null;
    let visibleLimit = pageSize;

    function renderResults(resetLimit) {
      if (resetLimit) visibleLimit = pageSize;
      const filterResult = window.MessageChooseFilters.getFilterResult(data.items || [], activeState);
      const filteredItems = filterResult.items;
      const displayedItems = filteredItems.slice(0, visibleLimit);
      if (filterResult.isSourceRelaxed && filteredItems.length > 0) {
        feed.innerHTML = `<div class="fallback-notice">所选来源“${escapeHtml(filterResult.selectedSource)}”未找到“${escapeHtml(filterResult.keyword)}”，以下为其他来源的匹配结果。</div><div id="fallback-feed"></div>`;
        window.MessageChooseRender.renderFeed(feed.querySelector("#fallback-feed"), displayedItems);
        updateSummary(data, displayedItems.length, filteredItems.length, `已放宽来源，显示 ${displayedItems.length} / ${filteredItems.length} 条跨来源匹配结果。`);
      } else if (!filteredItems.length) {
        window.MessageChooseRender.renderEmptyState(feed, {
          title: "没有匹配结果",
          detail: activeState.source !== "all" && activeState.keyword
            ? `关键词“${activeState.keyword}”在来源“${activeState.source}”、最低评分 ${activeState.minScore} 下没有匹配。`
            : `当前频道、来源和最低评分 ${activeState.minScore} 下没有匹配。`,
          actions: [
            { id: "clear-keyword", label: "清除关键词" },
            { id: "reset-filters", label: "重置筛选" }
          ]
        });
        updateSummary(data, 0, 0);
      } else {
        window.MessageChooseRender.renderFeed(feed, displayedItems);
        updateSummary(data, displayedItems.length, filteredItems.length);
      }

      const remainingCount = filteredItems.length - displayedItems.length;
      const nextVisibleLimit = Math.min(filteredItems.length, visibleLimit * 2);
      loadMoreButton.hidden = remainingCount <= 0;
      loadMoreButton.textContent = `展开至 ${nextVisibleLimit} 条（剩余 ${remainingCount} 条）`;
    }

    window.MessageChooseRender.renderChannelSummary(summary, data);
    renderTopHotspots(data);
    renderDailyFocus(daily, data, health);
    window.MessageChooseSourceStatus.renderSourceStatus(sourceStatus, health);
    const sourceHealthSummary = window.MessageChooseSourceStatus.summarizeSourceHealth(health);
    sourceSummary.textContent = sourceHealthSummary.text;
    sourceDisclosure.classList.toggle("has-warning", sourceHealthSummary.hasWarning);
    sourceToggle.addEventListener("click", () => {
      const expanded = sourceToggle.getAttribute("aria-expanded") === "true";
      sourceToggle.setAttribute("aria-expanded", String(!expanded));
      sourceStatus.hidden = expanded;
    });

    filterControls = window.MessageChooseFilters.initFilters(config, data, (state) => {
      activeState = state;
      renderResults(true);
    });
    feed.addEventListener("click", (event) => {
      const action = event.target.closest("[data-empty-action]")?.dataset.emptyAction;
      if (action === "clear-keyword") filterControls?.clearKeyword();
      if (action === "reset-filters") filterControls?.resetFilters();
    });
    loadMoreButton.addEventListener("click", () => {
      visibleLimit *= 2;
      renderResults(false);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
