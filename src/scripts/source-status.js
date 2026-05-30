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
      empty: "无新数据",
      failed: "失败"
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
              <span>失败 ${Number(source.failureCount || 0)}</span>
              ${Number(source.attempts || 1) > 1 ? `<span>尝试 ${Number(source.attempts)} 次</span>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function summarizeSourceHealth(health) {
    const sources = health.sources || [];
    const healthy = sources.filter((source) => source.status === "healthy").length;
    const abnormal = sources.length - healthy;
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
      abnormal,
      lastCheckedAt,
      hasWarning: abnormal > 0,
      text: `来源 ${healthy} 个正常，${abnormal} 个异常，最近检查 ${timeLabel}`
    };
  }

  window.MessageChooseSourceStatus = {
    renderSourceStatus,
    summarizeSourceHealth
  };
})();
