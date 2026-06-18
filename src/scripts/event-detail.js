(function () {
  const FALLBACK_EVENTS = {
    generatedAt: "",
    events: []
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

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
      const [, month, day] = String(value).split("-");
      return `${Number(month)}月${Number(day)}日`;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
    } catch {
      return "";
    }
  }

  function articleDetailUrl(item) {
    const id = String(item?.id || "").trim();
    if (id) return `article.html?id=${encodeURIComponent(id)}`;
    const url = safeExternalUrl(item?.url);
    return url ? `article.html?url=${encodeURIComponent(url)}` : "article.html";
  }

  function renderList(title, values, fallback) {
    const items = (values || []).filter(Boolean);
    return `
      <section>
        <h2>${escapeHtml(title)}</h2>
        ${items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>${escapeHtml(fallback)}</p>`}
      </section>
    `;
  }

  function renderImpactAnalysis(analysis) {
    const data = analysis || {};
    const entries = [
      ["市场影响", data.market],
      ["行业影响", data.industry],
      ["公司影响", data.company],
      ["用户影响", data.user]
    ];
    return `
      <section class="event-detail-section">
        <h2>影响分析</h2>
        <div class="event-impact-grid">
          ${entries.map(([label, value]) => `
            <article>
              <strong>${escapeHtml(label)}</strong>
              <p>${escapeHtml(value || "目前证据不足，暂不下结论。")}</p>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderTimeline(timeline) {
    const items = (timeline || []).filter(Boolean);
    return `
      <section class="event-detail-section">
        <h2>事件时间线</h2>
        ${items.length ? `
          <ol class="event-timeline event-detail-timeline">
            ${items.map((item) => {
              const articleUrl = safeExternalUrl(item.url) ? articleDetailUrl(item) : "";
              const title = articleUrl
                ? `<a href="${escapeHtml(articleUrl)}">${escapeHtml(item.title || "事件进展")}</a>`
                : escapeHtml(item.title || "事件进展");
              const sourceText = (item.sources || [])
                .map((source) => source.source || source.title)
                .filter(Boolean)
                .slice(0, 3)
                .join("、");
              return `
                <li>
                  <time>${escapeHtml(formatDate(item.date || item.publishedAt))}</time>
                  <div>
                    <h3>${title}</h3>
                    <p>${escapeHtml(item.description || item.summary || "")}</p>
                    <span>${escapeHtml(item.evidence_type || "unknown")} · ${escapeHtml(item.importance || "中")} · ${escapeHtml(sourceText || item.source || "公开来源")}</span>
                  </div>
                </li>
              `;
            }).join("")}
          </ol>
        ` : `<p class="event-detail-muted">暂无时间线。</p>`}
      </section>
    `;
  }

  function renderRelatedArticles(articles) {
    const items = (articles || []).filter((article) => article.title || article.url);
    return `
      <section class="event-detail-section">
        <h2>相关原文</h2>
        ${items.length ? `
          <ul class="event-item-list event-related-list">
            ${items.map((article) => {
              const originalUrl = safeExternalUrl(article.url);
              const detailUrl = originalUrl ? articleDetailUrl(article) : "";
              return `
                <li>
                  <h3>${detailUrl ? `<a href="${escapeHtml(detailUrl)}">${escapeHtml(article.title || "相关原文")}</a>` : escapeHtml(article.title || "相关原文")}</h3>
                  <p>${escapeHtml(article.summary || "")}</p>
                  <span>${escapeHtml(article.source || "公开来源")} · ${escapeHtml(formatDate(article.published_at))} · 相关度 ${Number(article.relevance_score || 0)}</span>
                  ${originalUrl ? `<div class="event-source-actions"><a href="${escapeHtml(detailUrl)}">查看摘要</a><a href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">打开原文</a></div>` : ""}
                </li>
              `;
            }).join("")}
          </ul>
        ` : `<p class="event-detail-muted">暂无相关原文。</p>`}
      </section>
    `;
  }

  function renderQuestions(questions) {
    const items = (questions || []).filter(Boolean);
    return `
      <section class="event-detail-section">
        <h2>我的追问</h2>
        ${items.length ? `
          <ul class="event-note-list">
            ${items.map((item) => `
              <li>
                <strong>${escapeHtml(item.question || "")}</strong>
                <span>${escapeHtml(item.status || "待分析")} · ${escapeHtml(item.created_at || "")}</span>
              </li>
            `).join("")}
          </ul>
        ` : `<p class="event-detail-muted">暂无追问记录，可在后续阶段通过 JSON 手动维护。</p>`}
      </section>
    `;
  }

  function renderAnalysisNotes(notes) {
    const items = (notes || []).filter(Boolean);
    return `
      <section class="event-detail-section">
        <h2>分析记录</h2>
        ${items.length ? `
          <ul class="event-note-list">
            ${items.map((note) => `
              <li>
                <strong>${escapeHtml(note.title || "分析记录")}</strong>
                <p>${escapeHtml(note.core_judgment || "")}</p>
                <span>${escapeHtml(note.created_at || "")}</span>
              </li>
            `).join("")}
          </ul>
        ` : `<p class="event-detail-muted">暂无分析记录。后续可补充事实、推论、不确定性和观察变量。</p>`}
      </section>
    `;
  }

  function renderEvent(container, event) {
    const facts = event.confirmed_facts || event.confirmedFacts || [];
    const watchVariables = event.watch_variables || event.watchlist || [];
    const relatedArticles = event.related_articles || event.evidenceItems || event.items || [];
    document.title = `${event.title || "事件追踪详情"} - Message Choose`;
    container.innerHTML = `
      <article class="event-detail-view">
        <a class="text-link event-back-link" href="events.html">返回重点事件</a>
        <header class="event-detail-hero">
          <div class="event-decision-meta">
            <span>${escapeHtml(event.current_status || "持续跟踪")}</span>
            <span>重要性：${escapeHtml(event.importance_level || event.heat || "中")}</span>
            <span>置信度：${escapeHtml(event.confidence_level || event.sourceQuality?.confidence || "中")}</span>
            <span>更新：${escapeHtml(event.last_updated || formatDate(event.updatedAt))}</span>
          </div>
          <h1>${escapeHtml(event.title || "重点事件")}</h1>
          <p>${escapeHtml(event.one_sentence_summary || event.summary || "")}</p>
          <div class="event-detail-latest">
            <strong>最新变化</strong>
            <p>${escapeHtml(event.latest_change || event.latestUpdate?.summary || "暂无最新变化。")}</p>
          </div>
        </header>

        <section class="event-detail-section">
          <h2>当前判断</h2>
          <p>${escapeHtml(event.decisionBrief || "当前证据仍需继续观察。")}</p>
          <div class="tag-row">
            ${(event.category || event.impactAreas || event.keywords || []).slice(0, 8).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
          </div>
        </section>

        ${renderTimeline(event.timeline)}
        <div class="event-detail-grid">
          ${renderList("已确认事实", facts, "暂无足够确认事实，建议打开证据原文核对。")}
          ${renderList("不确定性", event.uncertainties || event.riskFactors, "暂无明确不确定性记录。")}
          ${renderList("后续观察变量", watchVariables, "暂无后续观察变量。")}
          ${renderList("市场 / 外部反馈", event.market_feedback, "暂无可展示的市场或外部反馈。")}
        </div>
        ${renderImpactAnalysis(event.impact_analysis)}
        ${renderRelatedArticles(relatedArticles)}
        <div class="event-detail-grid">
          ${renderQuestions(event.my_questions)}
          ${renderAnalysisNotes(event.analysis_notes)}
        </div>
      </article>
    `;
  }

  function renderMissing(container, message) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>没有找到事件</h3>
        <p>${escapeHtml(message)}</p>
        <div class="empty-actions">
          <a class="ghost-button" href="events.html">返回重点事件</a>
        </div>
      </div>
    `;
  }

  async function init() {
    const container = document.getElementById("event-detail");
    if (!container) return;

    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) {
      renderMissing(container, "URL 中缺少事件 ID。");
      return;
    }

    const data = await loadJson("src/data/events.json", FALLBACK_EVENTS);
    const event = (data.events || []).find((item) => String(item.event_id || item.id) === id);
    if (!event) {
      renderMissing(container, `当前数据中没有 ID 为 ${id} 的事件。`);
      return;
    }

    renderEvent(container, event);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
