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

  function renderFeed(container, items) {
    if (!items.length) {
      renderEmptyState(container, {
        title: "当前筛选条件下没有可展示的信息。",
        detail: ""
      });
      return;
    }

    container.innerHTML = items.map((item) => {
      const tags = [item.category, ...(item.keywords || []).slice(0, 3), ...(item.tags || []).slice(0, 2)]
        .filter(Boolean)
        .filter((tag, index, list) => list.indexOf(tag) === index)
        .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
        .join("");
      const duplicateText = item.duplicateCount > 0 ? ` · 合并 ${item.duplicateCount} 条重复` : "";
      const score = Number(item.score || 0);
      const safeUrl = safeExternalUrl(item.url);
      const summary = item.aiSummary || item.contentExcerpt || item.summary;
      const title = safeUrl
        ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>`
        : escapeHtml(item.title);

      return `
        <article class="feed-card">
          <div>
            <h3>${title}</h3>
            ${renderSummary(summary)}
            ${item.summaryReason ? `<p class="summary-reason">${escapeHtml(item.summaryReason)}</p>` : ""}
            <div class="item-meta">
              <span>${escapeHtml(item.source)}</span>
              <span>发布 ${formatDate(item.publishedAt)}</span>
              <span>采集 ${formatDate(item.fetchedAt)}</span>
              <span>${escapeHtml(sourceAuthorityLabel(item.sourceAuthority))}</span>
              <span>${escapeHtml(timelinessLabel(item.timelinessTier))}</span>
              <span>${escapeHtml(item.sourceType || "rss")}${duplicateText}</span>
            </div>
            <div class="tag-row" aria-label="标签">${tags}</div>
          </div>
          <div class="score-block" aria-label="评分 ${score}">
            <div class="score-value">${score}</div>
            <div class="score-meter"><span style="width: ${Math.max(0, Math.min(100, score))}%"></span></div>
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
          ${channel.modelSummary ? `<p class="weekly-model-summary">${escapeHtml(channel.modelSummary)}</p>` : ""}
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
              const safeUrl = safeExternalUrl(item.url);
              const title = safeUrl
                ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>`
                : escapeHtml(item.title);
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
    safeExternalUrl
  };
})();
