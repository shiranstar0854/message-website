(function () {
  function formatDate(value) {
    if (!value) return "时间未知";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
    } catch {
      return "";
    }
  }

  function itemDetailUrl(item) {
    const id = String(item?.id || "").trim();
    if (id) return `article.html?id=${encodeURIComponent(id)}`;

    const url = safeExternalUrl(item?.url);
    return url ? `article.html?url=${encodeURIComponent(url)}` : "article.html";
  }

  function renderChannelSummary(container, data) {
    const channels = Object.values(data.channels || {});
    container.innerHTML = channels.map((channel) => `
      <div class="metric-tile">
        <strong>${Number(channel.count || channel.items?.length || 0)}</strong>
        <span>${escapeHtml(channel.label)}频道</span>
      </div>
    `).join("");
  }

  function renderSummary(value) {
    const summary = String(value || "").trim();
    if (!summary) return "";
    if (summary.length <= 120) {
      return `<p class="feed-summary">${escapeHtml(summary)}</p>`;
    }

    const preview = `${summary.slice(0, 120).trim()}...`;
    return `
      <details class="feed-summary-disclosure">
        <summary>
          <span class="feed-summary-preview">${escapeHtml(preview)}</span>
          <span class="feed-summary-toggle" aria-hidden="true"></span>
        </summary>
        <p class="feed-summary-full">${escapeHtml(summary)}</p>
      </details>
    `;
  }

  function sourceAuthorityLabel(value) {
    return {
      "official-agency": "官方机构",
      "official-market": "官方市场",
      "official-media": "官方媒体",
      media: "媒体"
    }[value] || value || "来源";
  }

  function timelinessLabel(value) {
    return {
      realtime: "实时",
      hourly: "小时级",
      daily: "日更",
      periodic: "定期"
    }[value] || value || "频率未知";
  }

  function isEnglishSourceItem(item) {
    return item.source_language === "en" || item.sourceLanguage === "en" || (/^[\x00-\x7F\s.,:'"!?()-]+$/.test(`${item.title || ""} ${item.summary || ""}`) && /[A-Za-z]/.test(item.title || ""));
  }

  function displayTitle(item) {
    return item.title_zh || item.titleZh || item.translatedTitle || item.title || "未命名信息";
  }

  function displayOriginalTitle(item) {
    return item.title_original || item.titleOriginal || item.title || displayTitle(item);
  }

  function displaySummary(item) {
    return item.summary_short || item.summary_zh || item.summaryZh || item.aiSummary || item.contentExcerpt || item.summary || item.summary_original || "";
  }

  function importanceLabel(value) {
    const score = Number(value || 0);
    if (score >= 85) return "高";
    if (score >= 65) return "中";
    return "低";
  }

  function renderDeepSummary(item) {
    const points = Array.isArray(item.summary_points) ? item.summary_points.slice(0, 5) : [];
    const keyData = Array.isArray(item.key_data) ? item.key_data.slice(0, 5) : [];
    if (!points.length && !keyData.length && !item.why_it_matters && !item.impact && !item.risks) return "";
    return `
      <details class="feed-deep-summary">
        <summary>展开深度摘要</summary>
        ${points.length ? `<ul>${points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : ""}
        ${keyData.length ? `<p><strong>关键数据</strong>${escapeHtml(keyData.join("；"))}</p>` : ""}
        ${item.why_it_matters ? `<p><strong>为什么重要</strong>${escapeHtml(item.why_it_matters)}</p>` : ""}
        ${item.impact ? `<p><strong>影响</strong>${escapeHtml(item.impact)}</p>` : ""}
        ${item.risks ? `<p><strong>风险</strong>${escapeHtml(item.risks)}</p>` : ""}
      </details>
    `;
  }

  function impactText(item) {
    if (item.importance || item.summaryReason) return item.importance || item.summaryReason;
    const areas = (item.impactAreas || item.article_keywords || item.keywords || []).slice(0, 2);
    if (areas.length) return `影响范围：${areas.join("、")}。`;
    return `评分 ${Number(item.score || 0)}，用于判断优先阅读价值。`;
  }

  function translationLabel(item) {
    return {
      translated: "已翻译",
      failed: "翻译失败",
      pending: "待翻译",
      not_required: "中文来源"
    }[item.translation_status] || "";
  }

  function renderFeed(container, items) {
    if (!items.length) {
      renderEmptyState(container, {
        title: "当前筛选条件下没有可展示的信息。",
        detail: ""
      });
      return;
    }

    container.innerHTML = items.map((item) => {
      const articleKeywords = item.article_keywords || item.keywords || [];
      const tags = [item.category, ...articleKeywords.slice(0, 3), ...(item.tags || []).slice(0, 2)]
        .filter(Boolean)
        .filter((tag, index, list) => list.indexOf(tag) === index)
        .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
        .join("");
      const duplicateText = item.duplicateCount > 0 ? ` · 合并 ${item.duplicateCount} 条重复` : "";
      const score = Number(item.score || 0);
      const importanceScore = Number(item.importance_score || score);
      const detailUrl = itemDetailUrl(item);
      const originalUrl = safeExternalUrl(item.original_url || item.url);
      const summary = displaySummary(item);
      const title = `<a href="${escapeHtml(detailUrl)}">${escapeHtml(displayOriginalTitle(item))}</a>`;
      const originalTitle = item.title_original || item.title;
      const translationText = translationLabel(item);

      return `
        <article class="feed-card news-shelf-item">
          <div>
            <div class="news-shelf-topline">
              <span>${escapeHtml(item.source || "公开来源")}</span>
              <span>${formatDate(item.publishedAt)}</span>
            </div>
            <h3>${title}</h3>
            ${summary ? `<p class="feed-core-summary">${escapeHtml(summary)}</p>` : ""}
            ${originalTitle && displayTitle(item) !== originalTitle ? `<p class="original-title">原文：${escapeHtml(originalTitle)}</p>` : ""}
            <div class="item-meta">
              <span>重要度：${importanceLabel(importanceScore)} ${importanceScore}</span>
              <span>${escapeHtml(item.category || "news")}</span>
              <span>${escapeHtml(sourceAuthorityLabel(item.sourceAuthority))}</span>
              <span>${escapeHtml(timelinessLabel(item.timelinessTier))}</span>
              ${translationText ? `<span>${escapeHtml(translationText)}</span>` : ""}
              <span>${escapeHtml(item.sourceType || "rss")}${duplicateText}</span>
            </div>
            <div class="tag-row" aria-label="标签">${tags}</div>
            ${item.searchHitLabels?.length ? `
              <div class="search-hit-row" aria-label="搜索命中原因">
                ${item.searchHitLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
              </div>
            ` : ""}
            ${renderDeepSummary(item)}
            <div class="feed-card-actions">
              <a class="summary-entry-link" href="${escapeHtml(detailUrl)}">详情摘要</a>
              ${originalUrl ? `<a class="original-entry" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">查看原文</a>` : ""}
            </div>
          </div>
          <div class="score-block" aria-label="重要度 ${importanceScore}">
            <div class="score-value">${importanceScore}</div>
            <div class="score-meter"><span style="width: ${Math.max(0, Math.min(100, importanceScore))}%"></span></div>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderWeeklyReview(container, summaryContainer, review) {
    const channels = review.channels || [];
    if (!channels.length) {
      container.innerHTML = '<div class="empty-state">暂无每周复盘。</div>';
      if (summaryContainer) summaryContainer.textContent = "周报数据尚未生成";
      return;
    }

    if (summaryContainer) {
      summaryContainer.textContent = `${escapeHtml(review.weekId || "本周")} · 覆盖 ${Number(review.totals?.archiveCount || 0)} 个每日归档，${Number(review.totals?.itemCount || 0)} 条候选信息`;
    }

    container.innerHTML = channels.map((channel) => {
      const highlights = (channel.highlights || []).slice(0, 3);
      const sources = (channel.topSources || []).slice(0, 4)
        .map((entry) => `<span class="tag">${escapeHtml(entry.source)} ${Number(entry.count || 0)}</span>`)
        .join("");

      return `
        <article class="weekly-column">
          <div class="weekly-column-head">
            <strong>${escapeHtml(channel.label || channel.id)}</strong>
            <span>${Number(channel.totalItems || 0)} 条</span>
          </div>
          <div class="tag-row" aria-label="${escapeHtml(channel.label || channel.id)}主要来源">${sources}</div>
          ${channel.focus ? `<p class="summary-focus">${escapeHtml(channel.focus)}</p>` : ""}
          ${channel.whyItMatters ? `<p class="summary-explainer">${escapeHtml(channel.whyItMatters)}</p>` : ""}
          ${channel.weekSignals?.length ? `
            <ul class="daily-keypoints">
              ${channel.weekSignals.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
            </ul>
          ` : ""}
          ${channel.watchlist?.length ? `
            <div class="weekly-watchlist">
              ${channel.watchlist.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
            </div>
          ` : ""}
          <ul class="weekly-highlight-list">
            ${highlights.map((item) => {
              const title = `<a href="${escapeHtml(itemDetailUrl(item))}">${escapeHtml(item.title)}</a>`;
              return `
                <li>
                  <h3>${title}</h3>
                  <p>${escapeHtml(item.summary || "")}</p>
                  <span>${escapeHtml(item.source || "")} · ${Number(item.score || 0)}</span>
                </li>
              `;
            }).join("")}
          </ul>
        </article>
      `;
    }).join("");
  }

  function renderEmptyState(container, state) {
    const actions = state.actions || [];
    container.innerHTML = `
      <div class="empty-state">
        <h3>${escapeHtml(state.title || "没有匹配结果")}</h3>
        ${state.detail ? `<p>${escapeHtml(state.detail)}</p>` : ""}
        ${actions.length ? `
          <div class="empty-actions">
            ${actions.map((action) => `
              <button class="ghost-button" type="button" data-empty-action="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>
            `).join("")}
          </div>
        ` : ""}
      </div>
    `;
  }

  window.MessageChooseRender = {
    formatDate,
    renderChannelSummary,
    renderEmptyState,
    renderFeed,
    renderWeeklyReview,
    renderSummary,
    safeExternalUrl,
    itemDetailUrl
  };
})();
