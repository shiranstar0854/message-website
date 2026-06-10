(function () {
  const FALLBACK_CONFIG = {
    siteName: "Message Choose",
    tagline: "科技、金融、新闻信息筛选台",
    defaultLimit: 6,
    defaultSort: "score-desc",
    scoreFloor: 60,
    channels: [
      { id: "tech", label: "科技", description: "AI、云计算、芯片、开发者平台与安全基础设施。" },
      { id: "finance", label: "金融", description: "央行、监管、市场结构、宏观数据与风险信号。" },
      { id: "business", label: "商业", description: "公司经营、财报、产业竞争、并购上市与消费市场。" },
      { id: "macro", label: "宏观", description: "财政货币政策、经济数据、利率、通胀与周期信号。" },
      { id: "international", label: "国际", description: "国际关系、地缘政治、全球监管和跨境市场事件。" },
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
      business: { label: "商业", count: 0, items: [] },
      macro: { label: "宏观", count: 0, items: [] },
      international: { label: "国际", count: 0, items: [] },
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

  const FALLBACK_EVENTS = {
    generatedAt: "",
    totalEvents: 0,
    events: []
  };
  const EVENT_REFRESH_MS = 120000;

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

  function formatTimelineDate(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
      const [, month, day] = String(value).split("-");
      return `${Number(month)}月${Number(day)}日`;
    }
    return formatShortDate(value);
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

  function isEnglishSourceItem(item) {
    return item.source_language === "en" || item.sourceLanguage === "en" || (/^[\x00-\x7F\s.,:'"!?()-]+$/.test(`${item.title || ""} ${item.summary || ""}`) && /[A-Za-z]/.test(item.title || ""));
  }

  function displayTitle(item) {
    return item.title_zh || item.titleZh || item.translatedTitle || item.title || "未命名信息";
  }

  function shortExplanation(item) {
    const text = item.summary_zh || item.summaryZh || item.aiSummary || item.contentExcerpt || item.summary || item.summary_original || "暂无摘要。";
    return text.length > 86 ? `${text.slice(0, 83).trimEnd()}...` : text;
  }

  function importanceText(item) {
    return item.importance || item.summaryReason || `评分 ${Number(item.score || 0)}，来自${item.source || "公开来源"}。`;
  }

  function impactAreas(item, data) {
    const areas = (item.impactAreas || []).length
      ? item.impactAreas
      : (item.article_keywords || item.keywords || item.tags || []).slice(0, 4);
    return areas.length ? areas : [channelLabel(data, item.category)];
  }

  function hotspotTags(item, data) {
    return impactAreas(item, data).slice(0, 2);
  }

  function selectTopHotspots(items) {
    const seenKeys = new Set();
    return [...(items || [])]
      .sort((left, right) => hotspotRankScore(right) - hotspotRankScore(left)
        || Number(right.score || 0) - Number(left.score || 0)
        || new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime())
      .filter((item) => {
        const key = hotspotEventKey(item);
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      })
      .slice(0, 5);
  }

  function hotspotEventKey(item) {
    const keywords = (item.impactAreas || item.article_keywords || item.keywords || item.tags || []).slice(0, 2).join("|").toLowerCase();
    return keywords || String(displayTitle(item)).toLowerCase().slice(0, 24);
  }

  function hotspotRankScore(item) {
    const publishedTime = new Date(item.publishedAt || 0).getTime();
    const freshness = Number.isNaN(publishedTime) ? 0 : Math.max(0, 12 - (Date.now() - publishedTime) / (6 * 60 * 60 * 1000));
    const readableBonus = (item.aiSummary || item.summaryZh || item.contentExcerpt ? 8 : 0) + (item.importance || item.summaryReason ? 5 : 0);
    const sourceBonus = ["official-agency", "official-market", "official-media"].includes(item.sourceAuthority) ? 4 : 0;
    return Number(item.score || 0) + freshness + readableBonus + sourceBonus;
  }

  function renderTopHotspots(data) {
    const container = document.getElementById("top-hotspot-list");
    if (!container) return;

    const items = selectTopHotspots(data.items || []);
    if (!items.length) {
      container.innerHTML = `<div class="empty-state compact-empty">暂无核心热点，信息流更新后会自动生成。</div>`;
      return;
    }

    const renderHotspotCard = (item, index) => {
      const safeUrl = window.MessageChooseRender.safeExternalUrl(item.url);
      const summary = shortExplanation(item);
      const source = item.source || "公开来源";
      const updatedAt = formatShortDate(item.publishedAt);
      const heat = Number(item.score || 0) >= 90 ? "高" : Number(item.score || 0) >= 75 ? "中" : "低";
      const cardContent = `
        <div class="top-hotspot-rank">#${index + 1}</div>
        <div class="top-hotspot-body">
          <h3>${escapeHtml(displayTitle(item))}</h3>
          <p class="top-hotspot-summary">${escapeHtml(summary)}</p>
          <p class="top-hotspot-why">${escapeHtml(importanceText(item))}</p>
          <div class="top-hotspot-meta">
            <span>来源：${escapeHtml(source)}</span>
            <span>热度：${heat}</span>
            <span>更新时间：${escapeHtml(updatedAt)}</span>
          </div>
        </div>`;
      return `
        <article class="top-hotspot-card top-hotspot-row${index === 0 ? " is-primary" : ""}">
          ${safeUrl
            ? `<a class="top-hotspot-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${cardContent}</a>`
            : `<div class="top-hotspot-link">${cardContent}</div>`}
        </article>
      `;
    };

    container.innerHTML = items.map((item, index) => renderHotspotCard(item, index)).join("");
  }

  function renderHomeEvents(eventData) {
    const container = document.getElementById("home-event-list");
    if (!container) return;
    const events = [...(eventData.events || [])]
      .sort((left, right) => eventRankScore(right) - eventRankScore(left)
        || new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime())
      .slice(0, 3);
    if (!events.length) {
      container.innerHTML = `<div class="empty-state compact-empty">暂无可追踪事件，信息流更新后会自动生成。</div>`;
      return;
    }

    container.innerHTML = events.map((event) => {
      const evidence = event.evidenceItems || event.items || [];
      const latest = event.latestUpdate || evidence[0] || {};
      const latestUrl = window.MessageChooseRender.safeExternalUrl(latest.url);
      const latestTitle = latestUrl
        ? `<a href="${escapeHtml(latestUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(latest.title || "")}</a>`
        : escapeHtml(latest.title || "");
      return `
        <article class="home-event-card">
          <div class="home-event-head">
            <h3>${escapeHtml(event.title || "重点事件")}</h3>
            <span>热度：${escapeHtml(event.heat || "中")}</span>
          </div>
          <p>${escapeHtml(event.summary || "暂无事件摘要。")}</p>
          <div class="home-event-latest">
            <strong>最新进展</strong>
            <p>${latestTitle}</p>
            <span>来源：${escapeHtml(latest.source || event.primarySource || "公开来源")} · 时间：${escapeHtml(formatShortDate(latest.publishedAt || event.updatedAt))}</span>
          </div>
          <ol class="home-event-timeline">
            ${(event.keyDevelopments || event.timeline || evidence).slice(-4).map((item) => `
              <li>
                <time>${escapeHtml(formatTimelineDate(item.date || item.publishedAt))}</time>
                <span>${escapeHtml(item.title || "")}<small>${escapeHtml(item.source || "")}</small></span>
              </li>
            `).join("")}
          </ol>
          <a class="text-link" href="events.html">查看事件追踪</a>
        </article>
      `;
    }).join("");
  }

  function eventRankScore(event) {
    const evidence = event.evidenceItems || event.items || [];
    const updatedTime = new Date(event.updatedAt || 0).getTime();
    const freshness = Number.isNaN(updatedTime) ? 0 : Math.max(0, 16 - (Date.now() - updatedTime) / (6 * 60 * 60 * 1000));
    const topScore = Number(evidence[0]?.score || 0);
    return topScore + freshness + (event.whyItMatters ? 8 : 0) + (event.watchlist?.length ? 5 : 0) + Math.min(10, Number(event.itemCount || evidence.length || 0));
  }

  async function init() {
    const [config, data, health, daily, eventData] = await Promise.all([
      loadJson("public/site-config.json", FALLBACK_CONFIG),
      loadJson("src/data/latest-items.json", FALLBACK_DATA),
      loadJson("src/data/source-health.json", FALLBACK_HEALTH),
      loadJson("src/data/daily-summary.json", FALLBACK_DAILY),
      loadJson("src/data/events.json", FALLBACK_EVENTS)
    ]);

    const feed = document.getElementById("feed");
    const summary = document.getElementById("channel-summary");
    const sourceDisclosure = document.getElementById("source-disclosure");
    const sourceSummary = document.getElementById("source-summary");
    const sourceStatus = document.getElementById("source-status");
    const sourceToggle = document.getElementById("source-toggle");
    const loadMoreButton = document.getElementById("load-more");
    const pageSize = Number(data.defaultLimit || config.defaultLimit || 6);
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
            { id: "lower-score", label: "降低评分门槛" },
            { id: "view-all", label: "查看全部" },
            { id: "clear-keyword", label: "清除关键词" },
            { id: "reset-filters", label: "重置筛选" }
          ]
        });
        updateSummary(data, 0, 0);
      } else {
        window.MessageChooseRender.renderFeed(feed, displayedItems);
        const keyword = activeState.keyword?.trim();
        const labels = keyword && displayedItems[0]?.searchHitLabels?.length
          ? `；首条命中：${displayedItems[0].searchHitLabels.join("、")}`
          : "";
        updateSummary(data, displayedItems.length, filteredItems.length, keyword
          ? `搜索“${keyword}”找到 ${filteredItems.length} 条，当前显示 ${displayedItems.length} 条${labels}。`
          : "");
      }

      const remainingCount = filteredItems.length - displayedItems.length;
      const nextVisibleLimit = Math.min(filteredItems.length, visibleLimit * 2);
      loadMoreButton.hidden = remainingCount <= 0;
      loadMoreButton.textContent = `展开至 ${nextVisibleLimit} 条（剩余 ${remainingCount} 条）`;
    }

    window.MessageChooseRender.renderChannelSummary(summary, data);
    renderTopHotspots(data);
    renderHomeEvents(eventData);
    if (window.location.protocol !== "file:") {
      setInterval(async () => {
        const refreshedEvents = await loadJson("src/data/events.json", FALLBACK_EVENTS);
        if (refreshedEvents.generatedAt && refreshedEvents.generatedAt !== eventData.generatedAt) {
          eventData.generatedAt = refreshedEvents.generatedAt;
          eventData.totalEvents = refreshedEvents.totalEvents;
          eventData.events = refreshedEvents.events || [];
          renderHomeEvents(eventData);
        }
      }, EVENT_REFRESH_MS);
    }
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
      if (action === "lower-score") filterControls?.lowerScoreFloor();
      if (action === "view-all") filterControls?.viewAll();
    });
    loadMoreButton.addEventListener("click", () => {
      visibleLimit *= 2;
      renderResults(false);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
