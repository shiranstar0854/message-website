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
    const summaries = daily.channels || daily.channelSummaries || [];
    const dailyGeneratedAt = daily.generated_at || daily.generatedAt || data.generatedAt;
    meta.textContent = `摘要更新 ${formatShortDate(dailyGeneratedAt)}；有新内容来源 ${healthy} 个，暂无48小时内新内容 ${empty} 个，抓取失败 ${abnormal} 个。`;

    if (!summaries.length) {
      grid.innerHTML = `
        <article class="focus-card"><strong>科技</strong><p>暂无摘要，信息流更新后会显示本频道重点。</p></article>
        <article class="focus-card"><strong>金融</strong><p>暂无摘要，信息流更新后会显示本频道重点。</p></article>
        <article class="focus-card"><strong>新闻</strong><p>暂无摘要，信息流更新后会显示本频道重点。</p></article>
      `;
      return;
    }

    grid.innerHTML = summaries.slice(0, 3).map((channel) => {
      const overview = channel.thinking_brief?.surface_summary || channel.overview || "";
      const keyPoints = Array.isArray(channel.key_signals)
        ? channel.key_signals.map((item) => item.signal).filter(Boolean)
        : (channel.keyPoints || []);
      return `
        <article class="focus-card">
          <strong>${escapeHtml(channel.label || channel.id)}</strong>
          <p>${escapeHtml(overview)}</p>
          ${keyPoints.length ? `
            <ul>
              ${keyPoints.slice(0, 3).map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
            </ul>
          ` : ""}
        </article>
      `;
    }).join("");
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
    const text = item.summary_short || item.summary_zh || item.summaryZh || item.aiSummary || item.contentExcerpt || item.summary || item.summary_original || "暂无摘要。";
    return text.length > 86 ? `${text.slice(0, 83).trimEnd()}...` : text;
  }

  function importanceText(item) {
    return item.why_it_matters || item.importance || item.summaryReason || `重要度 ${Number(item.importance_score || item.score || 0)}，来自${item.source || "公开来源"}。`;
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

  function selectTopHotspots(items, limit = 5) {
    const seenKeys = new Set();
    return [...(items || [])]
      .filter((item) => !["C", "D"].includes(String(item.sourceTier || "").toUpperCase()))
      .sort((left, right) => hotspotRankScore(right) - hotspotRankScore(left)
        || Number(right.importance_score || right.score || 0) - Number(left.importance_score || left.score || 0)
        || new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime())
      .filter((item) => {
        const key = hotspotEventKey(item);
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      })
      .slice(0, limit);
  }

  function hotspotEventKey(item) {
    const keywords = (item.impactAreas || item.article_keywords || item.keywords || item.tags || []).slice(0, 2).join("|").toLowerCase();
    return keywords || String(displayTitle(item)).toLowerCase().slice(0, 24);
  }

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clampScore(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  function hasUsefulText(value) {
    const text = String(value || "").trim();
    return Boolean(text && !/不足以判断|暂无|unknown/i.test(text));
  }

  function textPool(item) {
    return [
      item.title,
      item.title_zh,
      item.summary,
      item.summary_zh,
      item.summary_short,
      item.aiSummary,
      item.why_it_matters,
      item.impact,
      item.risks,
      ...(item.article_keywords || []),
      ...(item.keywords || []),
      ...(item.impactAreas || []),
      ...(item.tags || [])
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function sourceTrustScore(item) {
    const preset = numberOrNull(item.source_trust_score);
    if (preset !== null) return clampScore(preset);
    if (item.sourceTier === "S") return 96;
    if (item.sourceTier === "A") return 86;
    if (item.sourceTier === "B") return 72;
    if (item.sourceTier === "C") return 35;
    if (item.sourceTier === "D") return 10;
    const authority = item.sourceAuthority || item.sourceType;
    if (["official-agency", "official-market"].includes(authority)) return 94;
    if (authority === "official-media") return 88;
    if (authority === "financial-media") return 78;
    if (authority === "media" || authority === "webpage" || authority === "rss") return 68;
    return clampScore(Number(item.credibility || 60));
  }

  function multiSourceScore(item) {
    const preset = numberOrNull(item.multi_source_score);
    if (preset !== null) return clampScore(preset);
    const duplicateCount = Number(item.duplicateCount || 0);
    const sourceBonus = ["official-agency", "official-market", "official-media"].includes(item.sourceAuthority) ? 10 : 0;
    return clampScore(45 + Math.min(40, duplicateCount * 14) + sourceBonus);
  }

  function eventImpactScore(item) {
    const preset = numberOrNull(item.event_impact_score);
    if (preset !== null) return clampScore(preset);
    const impactAreas = item.impactAreas || [];
    const keyData = item.key_data || [];
    const base = Number(item.importance_score || item.score || 0);
    const relevance = numberOrNull(item.event_relevance_score);
    const explanationBonus = hasUsefulText(item.why_it_matters) || hasUsefulText(item.impact) || hasUsefulText(item.importance) ? 8 : 0;
    return clampScore(Math.max(base, relevance || 0, 52 + Math.min(24, impactAreas.length * 8) + Math.min(12, keyData.length * 4) + explanationBonus));
  }

  function marketFeedbackScore(item) {
    const preset = numberOrNull(item.market_feedback_score);
    if (preset !== null) return clampScore(preset);
    const pool = textPool(item);
    let score = 35;
    if (["finance", "business", "macro"].includes(item.category || item.primaryCategory)) score += 18;
    if (/market|stock|share|股价|成交|市场|利率|通胀|监管|政策|开发者|官方回应/.test(pool)) score += 22;
    if ((item.key_data || []).length) score += 12;
    if (Number(item.duplicateCount || 0) > 0) score += 8;
    return clampScore(score);
  }

  function followUpValueScore(item) {
    const preset = numberOrNull(item.follow_up_value_score);
    if (preset !== null) return clampScore(preset);
    let score = 38;
    if (item.timeline_event_id) score += 24;
    if (hasUsefulText(item.risks)) score += 12;
    if (hasUsefulText(item.why_it_matters) || hasUsefulText(item.impact)) score += 14;
    if (hasUsefulText(item.importance) || hasUsefulText(item.summaryReason)) score += 8;
    if (hasUsefulText(item.summary_short) || hasUsefulText(item.aiSummary) || hasUsefulText(item.contentExcerpt)) score += 8;
    if ((item.summary_points || []).length >= 2) score += 6;
    if ((item.impactAreas || []).length >= 2) score += 6;
    return clampScore(score);
  }

  function freshnessScore(item) {
    const preset = numberOrNull(item.freshness_score);
    if (preset !== null) return clampScore(preset);
    const publishedTime = new Date(item.publishedAt || item.fetchedAt || 0).getTime();
    if (Number.isNaN(publishedTime)) return 35;
    const ageHours = Math.max(0, (Date.now() - publishedTime) / (60 * 60 * 1000));
    if (ageHours <= 6) return 100;
    if (ageHours <= 24) return clampScore(92 - ageHours * 1.5);
    if (ageHours <= 72) return clampScore(62 - (ageHours - 24) * 0.8);
    return 20;
  }

  function uncertaintyPenalty(item) {
    const preset = numberOrNull(item.uncertainty_penalty);
    if (preset !== null) return Math.max(0, preset);
    const confidence = String(item.confidence || "").toLowerCase();
    let penalty = confidence === "low" ? 14 : confidence === "medium" ? 6 : 0;
    if (/不足以判断|无法确认|未证实|传闻|rumor/.test(textPool(item))) penalty += 8;
    return penalty;
  }

  function duplicationPenalty(item) {
    const preset = numberOrNull(item.duplication_penalty);
    if (preset !== null) return Math.max(0, preset);
    return Math.min(8, Math.max(0, Number(item.duplicateCount || 0) - 2) * 2);
  }

  function clickbaitPenalty(item) {
    const preset = numberOrNull(item.clickbait_penalty);
    if (preset !== null) return Math.max(0, preset);
    return /震惊|爆炸|史诗级|重磅突发|必看|狂飙|!{2,}|？{2,}|\?{2,}/.test(String(item.title || "")) ? 10 : 0;
  }

  function topScoreBreakdown(item) {
    const preset = numberOrNull(item.top_score);
    const source = sourceTrustScore(item);
    const multi = multiSourceScore(item);
    const impact = eventImpactScore(item);
    const market = marketFeedbackScore(item);
    const followUp = followUpValueScore(item);
    const freshness = freshnessScore(item);
    const uncertainty = uncertaintyPenalty(item);
    const duplication = duplicationPenalty(item);
    const clickbait = clickbaitPenalty(item);
    const relevance = numberOrNull(item.event_relevance_score);
    const lowRelevancePenalty = relevance !== null && relevance < 45 ? 12 : 0;
    const computed = source * 0.20
      + multi * 0.20
      + impact * 0.20
      + market * 0.15
      + followUp * 0.15
      + freshness * 0.10
      - uncertainty
      - duplication
      - clickbait
      - lowRelevancePenalty;

    return {
      source_trust_score: source,
      multi_source_score: multi,
      event_impact_score: impact,
      market_feedback_score: market,
      follow_up_value_score: followUp,
      freshness_score: freshness,
      uncertainty_penalty: uncertainty,
      duplication_penalty: duplication,
      clickbait_penalty: clickbait,
      event_relevance_penalty: lowRelevancePenalty,
      top_score: clampScore(preset !== null ? preset : computed)
    };
  }

  function hotspotRankScore(item) {
    return topScoreBreakdown(item).top_score;
  }

  function renderTopHotspots(data) {
    const container = document.getElementById("top-hotspot-list");
    if (!container) return;

    const items = selectTopHotspots(data.items || [], 5);
    if (!items.length) {
      container.innerHTML = `<div class="empty-state compact-empty">暂无核心热点，信息流更新后会自动生成。</div>`;
      return;
    }

    const renderHotspotCard = (item, index) => {
      const detailUrl = window.MessageChooseRender.itemDetailUrl(item);
      const summary = shortExplanation(item);
      const source = item.source || "公开来源";
      const updatedAt = formatShortDate(item.publishedAt);
      const topScore = hotspotRankScore(item);
      const heat = topScore >= 65 ? "高" : topScore >= 45 ? "中" : "低";
      const cardContent = `
        <div class="top-hotspot-rank">#${index + 1}</div>
        <div class="top-hotspot-body">
          <h3>${escapeHtml(displayTitle(item))}</h3>
          <p class="top-hotspot-summary">${escapeHtml(summary)}</p>
          <p class="top-hotspot-why">${escapeHtml(importanceText(item))}</p>
          <div class="top-hotspot-meta">
            <span>来源：${escapeHtml(source)}</span>
            <span>重要度：${heat}</span>
            <span>Top分：${topScore}</span>
            <span>更新时间：${escapeHtml(updatedAt)}</span>
          </div>
        </div>`;
      return `
        <article class="top-hotspot-card top-hotspot-row${index === 0 ? " is-primary" : ""}${index >= 5 ? " is-compact" : ""}">
          <a class="top-hotspot-link" href="${escapeHtml(detailUrl)}">${cardContent}</a>
        </article>
      `;
    };

    const primaryItems = items.slice(0, 5);
    const moreItems = items.slice(5);
    container.innerHTML = `
      ${primaryItems.map((item, index) => renderHotspotCard(item, index)).join("")}
      ${moreItems.length ? `
        <div class="hotspot-more-list" aria-label="其余热点">
          ${moreItems.map((item, index) => renderHotspotCard(item, index + 5)).join("")}
        </div>
      ` : ""}
    `;
  }

  const HOME_EVENT_THEMES = [
    ["openai", "ai 模型", "ai模型", "模型竞争"],
    ["英伟达", "nvidia", "算力", "ai 算力", "芯片"],
    ["美联储", "fed", "federal reserve", "利率", "宏观利率"]
  ];

  function eventSearchText(event) {
    return [
      event.event_id,
      event.title,
      event.definition?.one_sentence,
      event.definition?.why_it_matters,
      event.decision?.brief,
      event.lane_id,
      event.lane_label,
      ...(event.profile?.impact_areas || []),
      ...(event.profile?.entities ? Object.values(event.profile.entities).flat() : [])
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function selectHomeEvents(events, limit = 3) {
    const ranked = [...(events || [])]
      .sort((left, right) => eventRankScore(right) - eventRankScore(left)
        || new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime());
    const selected = [];
    const used = new Set();

    for (const tokens of HOME_EVENT_THEMES) {
      const match = ranked.find((event) => {
        const id = event.event_id || event.title;
        return !used.has(id) && tokens.some((token) => eventSearchText(event).includes(token));
      });
      if (match) {
        selected.push(match);
        used.add(match.event_id || match.id || match.title);
      }
    }

    for (const event of ranked) {
      if (selected.length >= limit) break;
      const id = event.event_id || event.id || event.title;
      if (!used.has(id)) {
        selected.push(event);
        used.add(id);
      }
    }

    return selected.slice(0, limit);
  }

  function eventDetailUrl(event) {
    return "#";
  }

  function eventLatestChange(event) {
    const evidence = event.related_items || [];
    const latest = event.latest_update || evidence[0] || {};
    return event.current_judgment?.latest_change || latest.title || event.definition?.one_sentence || "等待最新信息更新";
  }

  function renderHomeEvents(eventData) {
    const container = document.getElementById("home-event-list");
    if (!container) return;
    const events = selectHomeEvents(eventData.events || [], 3);
    if (!events.length) {
      container.innerHTML = `<div class="empty-state compact-empty">暂无可追踪事件，信息流更新后会自动生成。</div>`;
      return;
    }

    container.innerHTML = events.map((event) => {
      const detailUrl = eventDetailUrl(event);
      const updatedAt = event.updated_at;
      const decision = event.decision || {};
      const definition = event.definition || {};
      const currentJudgment = event.current_judgment || {};
      const evidence = event.evidence || {};
      return `
        <article class="home-event-card">
          <a class="home-event-card-link" href="${escapeHtml(detailUrl)}" aria-label="查看${escapeHtml(event.title || "重点事件")}追踪详情">
            <div class="home-event-head">
              <div>
                <div class="event-decision-meta">
                  <span>${escapeHtml(event.status || "active")}</span>
                  <span>重要性：${escapeHtml(event.priority_grade || "中")}</span>
                </div>
                <h3>${escapeHtml(event.title || "重点事件")}</h3>
              </div>
            </div>
            <p class="home-event-summary">${escapeHtml(definition.one_sentence || "暂无事件摘要。")}</p>
            <div class="home-event-latest">
              <strong>最新变化</strong>
              <p>${escapeHtml(eventLatestChange(event))}</p>
            </div>
            <dl class="home-event-fields">
              <div><dt>当前状态</dt><dd>${escapeHtml(event.status || "active")}</dd></div>
              <div><dt>重要性</dt><dd>${escapeHtml(event.priority_grade || "中")}</dd></div>
              <div><dt>置信度</dt><dd>${escapeHtml(evidence.confidence_basis || currentJudgment.confidence_reason || "中")}</dd></div>
              <div><dt>更新时间</dt><dd>${escapeHtml(formatShortDate(updatedAt))}</dd></div>
            </dl>
            <span class="event-detail-button home-event-detail-button">查看追踪</span>
          </a>
        </article>
      `;
    }).join("");
  }

  function eventRankScore(event) {
    const evidence = event.related_items || [];
    const updatedTime = new Date(event.updated_at || 0).getTime();
    const freshness = Number.isNaN(updatedTime) ? 0 : Math.max(0, 16 - (Date.now() - updatedTime) / (6 * 60 * 60 * 1000));
    const topScore = Number(evidence[0]?.score || 0);
    return topScore + freshness
      + (event.definition?.why_it_matters || event.impact ? 8 : 0)
      + ((event.watch_variables)?.length ? 5 : 0)
      + Math.min(10, Number(event.profile?.related_item_count || evidence.length || 0));
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
    window.MessageChooseRender.renderFeed(document.getElementById("top-hotspot-list"), selectTopHotspots(data.items || [], 5));
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
