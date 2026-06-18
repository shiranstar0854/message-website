(function () {
  const FALLBACK_EVENTS = { generatedAt: "", events: [] };

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

  function asArray(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function primaryAnalysis(event) {
    const notes = asArray(event.analysis_notes);
    return notes.find((note) => note?.is_core_analysis)
      || notes[0]
      || event.llm_analysis
      || {
        core_change: event.decisionBrief || event.whyItMatters || event.one_sentence_summary || event.summary || "",
        confirmed_facts: event.confirmed_facts || event.confirmedFacts || [],
        impact_analysis: event.impact_analysis || {},
        forward_looking_scenarios: [],
        risk_factors: (event.uncertainties || event.riskFactors || []).map((risk) => ({ risk, type: "信息风险", reason: "" })),
        counter_arguments: [],
        watch_variables: event.watch_variables || event.watchlist || [],
        judgment_update: event.decisionBrief || "",
        tracking_decision: event.tracking_decision || event.decisionSignal || "",
        confidence_level: event.confidence_level || "",
        confidence_reason: "",
        source_links: event.related_articles || event.evidenceItems || event.items || [],
        analysis_quality_score: 0,
        quality_flags: ["使用兼容字段展示"],
        is_core_analysis: false
      };
  }

  function renderList(title, values, fallback, extra = "") {
    const items = asArray(values);
    return `
      <section class="event-detail-section">
        <h2>${escapeHtml(title)}</h2>
        ${extra}
        ${items.length ? `<ul class="event-analysis-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p class="event-detail-muted">${escapeHtml(fallback)}</p>`}
      </section>
    `;
  }

  function renderImpactAnalysis(analysis) {
    const data = analysis || {};
    const entries = [
      ["市场", data.market],
      ["行业", data.industry],
      ["公司", data.company],
      ["用户 / 开发者", data.user_or_developer || data.user]
    ];
    return `
      <section class="event-detail-section">
        <h2>影响分析</h2>
        <div class="event-impact-grid">
          ${entries.map(([label, value]) => `
            <article>
              <strong>${escapeHtml(label)}</strong>
              <p>${escapeHtml(value || "目前证据不足，暂不做确定判断。")}</p>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderScenarios(scenarios) {
    const items = asArray(scenarios);
    return `
      <section class="event-detail-section">
        <h2>前瞻情景</h2>
        ${items.length ? `
          <div class="event-analysis-card-grid">
            ${items.map((item) => `
              <article class="event-analysis-card">
                <div class="event-analysis-card-head">
                  <strong>${escapeHtml(item.scenario || "情景")}</strong>
                  <span>${escapeHtml(item.confidence || "中")}</span>
                </div>
                <dl>
                  <div><dt>触发条件</dt><dd>${escapeHtml(item.condition || "目前证据不足")}</dd></div>
                  <div><dt>可能结果</dt><dd>${escapeHtml(item.possible_result || "目前证据不足")}</dd></div>
                </dl>
              </article>
            `).join("")}
          </div>
        ` : `<p class="event-detail-muted">暂无可展示的前瞻情景。</p>`}
      </section>
    `;
  }

  function renderRisks(risks) {
    const items = asArray(risks);
    return `
      <section class="event-detail-section">
        <h2>风险因素</h2>
        ${items.length ? `
          <div class="event-analysis-card-grid">
            ${items.map((item) => `
              <article class="event-analysis-card risk-card">
                <div class="event-analysis-card-head">
                  <strong>${escapeHtml(item.type || "风险")}</strong>
                </div>
                <p>${escapeHtml(item.risk || "")}</p>
                <small>${escapeHtml(item.reason || "目前证据不足")}</small>
              </article>
            `).join("")}
          </div>
        ` : `<p class="event-detail-muted">暂无风险因素记录。</p>`}
      </section>
    `;
  }

  function renderQuality(note) {
    const score = Number(note.analysis_quality_score || 0);
    const flags = asArray(note.quality_flags);
    const isCore = Boolean(note.is_core_analysis);
    return `
      <section class="event-detail-section">
        <h2>分析质量提示</h2>
        <p>${isCore ? "该分析达到核心分析标准。" : "该分析质量未达到核心分析标准，仅作参考。"}</p>
        <div class="event-quality-meta">
          <span class="${isCore ? "quality-ok" : "quality-warning"}">${isCore ? "核心分析" : "参考分析"}</span>
          <span>质量分：${score}</span>
          ${note.status ? `<span>来源：${escapeHtml(note.status)}</span>` : ""}
        </div>
        ${flags.length ? `<ul class="event-analysis-list">${flags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join("")}</ul>` : ""}
      </section>
    `;
  }

  function renderSourceLinks(links) {
    const items = asArray(links).filter((item) => item.url);
    return `
      <section class="event-detail-section">
        <h2>原文入口</h2>
        ${items.length ? `
          <ul class="event-item-list event-related-list">
            ${items.map((article) => {
              const originalUrl = safeExternalUrl(article.url);
              const detailUrl = originalUrl ? articleDetailUrl(article) : "";
              return `
                <li>
                  <h3>${detailUrl ? `<a href="${escapeHtml(detailUrl)}">${escapeHtml(article.title || "相关原文")}</a>` : escapeHtml(article.title || "相关原文")}</h3>
                  <p>${escapeHtml(article.summary || "")}</p>
                  <span>${escapeHtml(article.source || "公开来源")} · ${escapeHtml(formatDate(article.published_at || article.publishedAt))}</span>
                  ${originalUrl ? `<div class="event-source-actions"><a href="${escapeHtml(detailUrl)}">查看摘要</a><a href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">打开原文</a></div>` : ""}
                </li>
              `;
            }).join("")}
          </ul>
        ` : `<p class="event-detail-muted">暂无可点击原文入口。</p>`}
      </section>
    `;
  }

  function renderTimeline(timeline) {
    const items = asArray(timeline);
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

  function renderAnalysisHistory(event, activeNote) {
    const notes = asArray(event.analysis_notes).filter((note) => note && note !== activeNote);
    if (!notes.length) return "";
    return `
      <section class="event-detail-section">
        <h2>低质量或历史分析记录</h2>
        <div class="event-analysis-card-grid">
          ${notes.slice(0, 6).map((note) => `
            <article class="event-analysis-card">
              <div class="event-analysis-card-head">
                <strong>${escapeHtml(note.core_change || "分析记录")}</strong>
                <span>${Number(note.analysis_quality_score || 0)}</span>
              </div>
              <p>${escapeHtml(note.judgment_update || note.confidence_reason || "")}</p>
              ${asArray(note.quality_flags).length ? `<small>${escapeHtml(note.quality_flags.join("；"))}</small>` : ""}
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderEvent(container, event) {
    const note = primaryAnalysis(event);
    document.title = `${event.title || "事件追踪详情"} - Message Choose`;
    container.innerHTML = `
      <article class="event-detail-view">
        <a class="text-link event-back-link" href="events.html">返回重点事件</a>
        <header class="event-detail-hero">
          <div class="event-decision-meta">
            <span>${escapeHtml(event.current_status || "持续跟踪")}</span>
            <span>重要性：${escapeHtml(event.importance_level || event.heat || "中")}</span>
            <span>置信度：${escapeHtml(note.confidence_level || event.confidence_level || "中")}</span>
            <span>更新：${escapeHtml(event.last_updated || formatDate(event.updatedAt))}</span>
          </div>
          <h1>${escapeHtml(event.title || "重点事件")}</h1>
          <p>${escapeHtml(event.one_sentence_summary || event.summary || "")}</p>
          <div class="event-detail-latest">
            <strong>最新变化</strong>
            <p>${escapeHtml(event.latest_change || event.latestUpdate?.summary || "暂无最新变化。")}</p>
          </div>
        </header>

        ${renderQuality(note)}
        <section class="event-detail-section event-core-change">
          <h2>事件核心变化</h2>
          <p>${escapeHtml(note.core_change || "目前证据不足。")}</p>
        </section>
        ${renderList("已确认事实", note.confirmed_facts, "暂无足够确认事实，建议打开证据原文核对。", "<p class=\"event-section-note\">仅展示有来源支撑的信息。</p>")}
        ${renderImpactAnalysis(note.impact_analysis)}
        ${renderScenarios(note.forward_looking_scenarios)}
        ${renderRisks(note.risk_factors)}
        ${renderList("为什么这件事可能被高估", note.counter_arguments, "暂无反向观点记录。")}
        ${renderList("后续观察变量", note.watch_variables, "暂无后续观察变量。")}
        <div class="event-detail-grid">
          <section class="event-detail-section">
            <h2>判断变化</h2>
            <p>${escapeHtml(note.judgment_update || "目前证据不足。")}</p>
          </section>
          <section class="event-detail-section">
            <h2>置信度说明</h2>
            <p><strong>${escapeHtml(note.confidence_level || "中")}</strong>：${escapeHtml(note.confidence_reason || "目前证据不足。")}</p>
          </section>
          <section class="event-detail-section">
            <h2>是否继续追踪</h2>
            <p>${escapeHtml(note.tracking_decision || event.tracking_decision || "暂时观察")}</p>
          </section>
        </div>
        ${renderTimeline(event.timeline)}
        ${renderSourceLinks(note.source_links || event.related_articles || event.evidenceItems || event.items)}
        ${renderAnalysisHistory(event, note)}
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
