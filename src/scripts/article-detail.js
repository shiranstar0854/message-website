(function () {
  const FALLBACK_LATEST = { items: [] };
  const FALLBACK_HISTORY = { days: [] };

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

  function escapeHtml(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
    } catch {
      return "";
    }
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function findItem(items, query) {
    const id = query.get("id");
    const url = query.get("url");
    return (items || []).find((item) => (id && String(item.id || "") === id) || (url && safeExternalUrl(item.url) === safeExternalUrl(url)));
  }

  async function findArticle(query) {
    const latest = await loadJson("src/data/latest-items.json", FALLBACK_LATEST);
    const current = findItem(latest.items || [], query);
    if (current) return current;
    const history = await loadJson("src/data/history-index.json", FALLBACK_HISTORY);
    for (const day of history.days || []) {
      const archive = await loadJson(day.url, { items: [] });
      const item = findItem(archive.items || [], query);
      if (item) return item;
    }
    return null;
  }

  function renderArticle(container, item) {
    const brief = item.article_brief;
    const title = brief?.title || item.title_zh || item.translatedTitle || item.title || "未命名信息";
    const originalTitle = item.title_original || item.title;
    const originalUrl = safeExternalUrl(item.original_url || item.url);
    document.title = `${title} - Message Choose`;
    container.innerHTML = `
      <header class="article-detail-header">
        <p class="article-paper-kicker">${escapeHtml(item.source || "公开来源")} · ${escapeHtml(formatDate(item.publishedAt))}</p>
        <h1>${escapeHtml(title)}</h1>
        ${originalTitle && originalTitle !== title ? `<p class="article-original-title">${escapeHtml(originalTitle)}</p>` : ""}
      </header>
      <div class="article-detail-copy">
        ${window.MessageChooseRender.renderArticleBrief(item, false, false)}
      </div>
      <footer class="article-actions">
        <a class="article-back-link" href="index.html">返回信息流</a>
        ${originalUrl ? `<a class="article-source-button" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">打开原文</a>` : ""}
      </footer>
    `;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("article-detail");
    const item = await findArticle(new URLSearchParams(window.location.search));
    if (!item) {
      container.innerHTML = '<div class="empty-state"><h1>未找到这篇文章</h1><p>该内容可能已归档，或链接参数不完整。</p><a class="article-back-link" href="index.html">返回信息流</a></div>';
      return;
    }
    renderArticle(container, item);
  });
})();
