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

  function renderFeed(container, items) {
    if (!items.length) {
      container.innerHTML = '<div class="empty-state">当前筛选条件下没有可展示的信息。</div>';
      return;
    }

    container.innerHTML = items.map((item) => {
      const tags = [item.category, ...(item.tags || []).slice(0, 3)]
        .filter(Boolean)
        .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
        .join("");
      const duplicateText = item.duplicateCount > 0 ? ` · 合并 ${item.duplicateCount} 条重复` : "";
      const score = Number(item.score || 0);
      const safeUrl = safeExternalUrl(item.url);
      const title = safeUrl
        ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>`
        : escapeHtml(item.title);

      return `
        <article class="feed-card">
          <div>
            <h3>${title}</h3>
            ${renderSummary(item.summary)}
            <div class="item-meta">
              <span>${escapeHtml(item.source)}</span>
              <span>${formatDate(item.publishedAt)}</span>
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

  window.MessageChooseRender = {
    formatDate,
    renderChannelSummary,
    renderFeed,
    renderSummary,
    safeExternalUrl
  };
})();
