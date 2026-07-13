(function () {
  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderSourceStatus(container, health) {
    const sources = health.sources || [];
    if (!sources.length) {
      container.innerHTML = '<div class="empty-state">暂无来源健康数据。</div>';
      return;
    }

    const statusLabels = {
      healthy: "正常",
      empty: "暂无48小时内新内容",
      failed: "抓取失败"
    };
    const authorityLabels = {
      "official-agency": "官方机构",
      "official-market": "官方市场",
      "official-media": "官方媒体",
      media: "媒体"
    };

    function formatDate(value) {
      return window.MessageChooseRender?.formatDate
        ? window.MessageChooseRender.formatDate(value)
        : "时间未知";
    }

    function formatCacheWindow(source) {
      const hours = Number(source.cacheTtlHours || 0);
      if (!hours && !source.cacheExpiresAt) return "";
      const duration = hours ? `\u7f13\u5b58 ${hours} \u5c0f\u65f6` : "\u7f13\u5b58\u65f6\u95f4\u672a\u77e5";
      return source.cacheExpiresAt
        ? `${duration}\uff0c\u5230\u671f ${formatDate(source.cacheExpiresAt)}`
        : duration;
    }

    container.innerHTML = `
      <div class="source-list">
        ${sources.map((source) => `
          <div class="source-row">
            <strong>${escapeHtml(source.name)}</strong>
            <div class="source-meta">
              <span class="status-dot status-${escapeHtml(source.status || "unknown")}">${escapeHtml(statusLabels[source.status] || "未知")}</span>
              <span>${escapeHtml(source.category)}</span>
              ${source.sourceAuthority ? `<span>${escapeHtml(authorityLabels[source.sourceAuthority] || source.sourceAuthority)}</span>` : ""}
              ${source.timelinessTier ? `<span>${escapeHtml(source.timelinessTier)}</span>` : ""}
              <span>最近检查 ${escapeHtml(formatDate(source.lastCheckedAt))}</span>
              <span>最近成功 ${escapeHtml(formatDate(source.lastSuccessAt))}</span>
              ${formatCacheWindow(source) ? `<span>${escapeHtml(formatCacheWindow(source))}</span>` : ""}
              ${Number(source.failureCount || 0) > 0 ? `<span>失败 ${Number(source.failureCount || 0)}</span>` : ""}
              ${Number(source.attempts || 1) > 1 ? `<span>尝试 ${Number(source.attempts)} 次</span>` : ""}
              ${source.policyStatus ? `<span>策略 ${escapeHtml(source.policyStatus)}</span>` : ""}
              ${Number.isFinite(Number(source.passRate)) ? `<span>通过率 ${Math.round(Number(source.passRate) * 100)}%</span>` : ""}
              ${Number.isFinite(Number(source.highValueRate)) ? `<span>高价值率 ${Math.round(Number(source.highValueRate) * 100)}%</span>` : ""}
              ${source.bodySuccessRate === null ? `<span>正文成功率 不适用</span>` : Number.isFinite(Number(source.bodySuccessRate)) ? `<span>正文成功率 ${Math.round(Number(source.bodySuccessRate) * 100)}%</span>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function summarizeSourceHealth(health) {
    const sources = health.sources || [];
    const healthy = sources.filter((source) => source.status === "healthy").length;
    const empty = sources.filter((source) => source.status === "empty").length;
    const abnormal = sources.filter((source) => source.status === "failed").length;
    const lastCheckedAt = sources
      .map((source) => source.lastCheckedAt)
      .filter(Boolean)
      .sort()
      .at(-1);
    const timeLabel = window.MessageChooseRender?.formatDate
      ? window.MessageChooseRender.formatDate(lastCheckedAt)
      : "时间未知";

    return {
      healthy,
      empty,
      abnormal,
      lastCheckedAt,
      hasWarning: abnormal > 0,
      text: `来源 ${healthy} 个有新内容，${empty} 个暂无48小时内新内容，${abnormal} 个抓取失败，最近检查 ${timeLabel}`
    };
  }

  window.MessageChooseSourceStatus = {
    renderSourceStatus,
    summarizeSourceHealth
  };
})();
