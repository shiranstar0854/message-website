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

    container.innerHTML = `
      <div class="source-list">
        ${sources.map((source) => `
          <div class="source-row">
            <strong>${escapeHtml(source.name)}</strong>
            <div class="source-meta">
              <span class="status-dot status-${escapeHtml(source.status || "unknown")}">${escapeHtml(statusLabels[source.status] || "未知")}</span>
              <span>${escapeHtml(source.category)}</span>
              <span>失败 ${Number(source.failureCount || 0)}</span>
              ${Number(source.attempts || 1) > 1 ? `<span>尝试 ${Number(source.attempts)} 次</span>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  window.MessageChooseSourceStatus = {
    renderSourceStatus
  };
})();
