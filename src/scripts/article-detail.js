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

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
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

  function renderList(title, values) {
    const list = Array.isArray(values) ? values.filter(Boolean) : [];
    if (!list.length) return "";
    return `
      <div class="article-summary-block">
        <strong>${escapeHtml(title)}</strong>
        <ul class="article-point-list">
          ${list.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  function renderTextBlock(title, value, className = "") {
    if (!value) return "";
    return `
      <div class="article-summary-block ${className}">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(value)}</p>
      </div>
    `;
  }

  function findItem(items, query) {
    const id = query.get("id");
    const url = query.get("url");
    return (items || []).find((item) => {
      if (id && String(item.id || "") === id) return true;
      if (url && safeExternalUrl(item.url) === safeExternalUrl(url)) return true;
      return false;
    });
  }

  async function findArticle(query) {
    const latest = await loadJson("src/data/latest-items.json", FALLBACK_LATEST);
    const latestItem = findItem(latest.items || [], query);
    if (latestItem) return latestItem;

    const history = await loadJson("src/data/history-index.json", FALLBACK_HISTORY);
    for (const day of history.days || []) {
      const archive = await loadJson(day.url, { items: [] });
      const item = findItem(archive.items || [], query);
      if (item) return item;
    }

    const eventData = await loadJson("src/data/events.json", { events: [] });
    const eventItems = (eventData.events || []).flatMap((event) => [
      event.latest_update,
      ...(event.timeline || []),
      ...(event.related_items || []),
      ...(event.evidence?.source_links || [])
    ]).filter(Boolean);
    const eventItem = findItem(eventItems, query);
    if (eventItem) return eventItem;

    return null;
  }

  function renderArticle(container, item) {
    const originalUrl = safeExternalUrl(item.original_url || item.url);
    const title = displayTitle(item);
    const originalTitle = displayOriginalTitle(item);
    const summary = displaySummary(item);
    const keywords = (item.article_keywords || item.keywords || item.tags || []).slice(0, 8);
    const why = item.why_it_matters || item.importance || item.summaryReason || "";
    const sourceLanguage = item.source_language || item.sourceLanguage || "zh";
    const translationStatus = item.translation_status || "";

    document.title = `${originalTitle} - Message Choose`;
    container.innerHTML = `
      <div class="article-paper-kicker">
        <span>${escapeHtml(item.source || "公开来源")}</span>
        <span>${escapeHtml(formatDate(item.publishedAt))}</span>
        <span>重要度 ${Number(item.importance_score || item.score || 0)}</span>
        ${item.confidence ? `<span>置信度 ${escapeHtml(item.confidence)}</span>` : ""}
      </div>
      <h1>${escapeHtml(title)}</h1>
      ${title !== originalTitle ? `<p class="article-original-title">${escapeHtml(originalTitle)}</p>` : ""}
      <div class="article-summary-block">
        <strong>核心结论</strong>
        <p>${escapeHtml(summary || "暂无摘要，建议打开原文查看。")}</p>
      </div>
      ${renderList("关键事实", item.summary_points)}
      ${renderList("关键数据", item.key_data)}
      ${renderTextBlock("为什么重要", why, "article-why-block")}
      ${renderTextBlock("影响", item.impact)}
      ${renderTextBlock("风险与不确定性", item.risks)}
      ${keywords.length ? `
        <div class="article-keywords" aria-label="关键词">
          ${keywords.map((keyword) => `<span>${escapeHtml(keyword)}</span>`).join("")}
        </div>
      ` : ""}
      <dl class="article-facts">
        <div><dt>来源</dt><dd>${escapeHtml(item.source || "公开来源")}</dd></div>
        <div><dt>发布时间</dt><dd>${escapeHtml(formatDate(item.publishedAt))}</dd></div>
        <div><dt>采集时间</dt><dd>${escapeHtml(formatDate(item.fetchedAt))}</dd></div>
        <div><dt>语言</dt><dd>${escapeHtml(sourceLanguage)}</dd></div>
        ${item.timeline_event_id ? `<div><dt>事件追踪ID</dt><dd>${escapeHtml(item.timeline_event_id)}</dd></div>` : ""}
        ${item.ai_model ? `<div><dt>摘要模型</dt><dd>${escapeHtml(item.ai_model)}</dd></div>` : ""}
        ${item.ai_generated_at ? `<div><dt>生成时间</dt><dd>${escapeHtml(formatDate(item.ai_generated_at))}</dd></div>` : ""}
        ${translationStatus ? `<div><dt>翻译状态</dt><dd>${escapeHtml(translationStatus)}</dd></div>` : ""}
      </dl>
      <div class="article-actions">
        <a class="article-back-link" href="index.html">返回信息流</a>
        ${originalUrl ? `<a class="article-source-button" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">打开原文</a>` : ""}
      </div>
    `;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("article-detail");
    const item = await findArticle(new URLSearchParams(window.location.search));
    if (!item) {
      container.innerHTML = `
        <div class="empty-state">
          <h1>未找到这篇文章</h1>
          <p>可能是数据已经归档或链接参数缺失。</p>
          <a class="article-back-link" href="index.html">返回信息流</a>
        </div>
      `;
      return;
    }

    renderArticle(container, item);
  });
})();
