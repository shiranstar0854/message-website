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

    container.innerHTML = `
      <div class="source-list">
        ${sources.map((source) => `
          <div class="source-row">
            <strong>${escapeHtml(source.name)}</strong>
            <div class="source-meta">
              <span class="status-dot">${escapeHtml(source.status || "unknown")}</span>
              <span>${escapeHtml(source.category)}</span>
              <span>失败 ${Number(source.failureCount || 0)}</span>
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
