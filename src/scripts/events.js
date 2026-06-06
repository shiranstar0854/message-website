(function () {
  const FALLBACK_EVENTS = {
    generatedAt: "",
    totalEvents: 0,
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

  function renderEvents(container, data) {
    if (!container) return;
    const events = data.events || [];
    if (!events.length) {
      window.MessageChooseRender.renderEmptyState(container, {
        title: "暂无可追踪的重点事件",
        detail: "事件页只展示至少包含两条相关信息的聚合主题，信息流更新后会自动生成。"
      });
      return;
    }

    container.innerHTML = events.map((event) => `
      <article class="event-card">
        <div class="event-card-head">
          <div>
            <h2>${escapeHtml(event.title)}</h2>
            <p>${escapeHtml(event.summary || "暂无事件摘要。")}</p>
          </div>
          <strong>${Number(event.itemCount || event.items?.length || 0)} 条</strong>
        </div>
        <div class="tag-row" aria-label="事件关键词">
          ${(event.keywords || []).slice(0, 6).map((keyword) => `<span class="tag">${escapeHtml(keyword)}</span>`).join("")}
        </div>
        <ul class="event-item-list">
          ${(event.items || []).map((item) => {
            const safeUrl = safeExternalUrl(item.url);
            const title = safeUrl
              ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>`
              : escapeHtml(item.title);
            return `
              <li>
                <h3>${title}</h3>
                <p>${escapeHtml(item.summary || "")}</p>
                <span>${escapeHtml(item.source || "公开来源")} · ${formatDate(item.publishedAt)} · ${Number(item.score || 0)}</span>
              </li>
            `;
          }).join("")}
        </ul>
      </article>
    `).join("");
  }

  function renderExplainedEvents(container, data) {
    if (!container) return;
    const events = data.events || [];
    if (!events.length) {
      window.MessageChooseRender.renderEmptyState(container, {
        title: "暂无可追踪的重点事件",
        detail: "事件页只展示至少包含两条相关信息的聚合主题，信息流更新后会自动生成。"
      });
      return;
    }

    container.innerHTML = events.map((event) => {
      const evidenceItems = event.evidenceItems || event.items || [];
      return `
        <article class="event-card">
          <div class="event-card-head">
            <div>
              <h2>${escapeHtml(event.title || "重点事件")}</h2>
              <p>${escapeHtml(event.summary || "暂无事件摘要。")}</p>
            </div>
            <strong>${Number(event.itemCount || evidenceItems.length || 0)} 条</strong>
          </div>
          <div class="event-explainer-grid">
            <section>
              <h3>为什么重要</h3>
              <p>${escapeHtml(event.whyItMatters || "该事件可能影响政策、市场、产业或国际变化判断。")}</p>
            </section>
            <section>
              <h3>接下来关注</h3>
              <ul>
                ${(event.watchlist || ["关注后续官方发布和市场反应"]).slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
              </ul>
            </section>
          </div>
          <div class="tag-row" aria-label="影响范围">
            ${(event.impactAreas || event.keywords || []).slice(0, 6).map((keyword) => `<span class="tag">${escapeHtml(keyword)}</span>`).join("")}
          </div>
          <h3 class="event-evidence-title">证据条目</h3>
          <ul class="event-item-list">
            ${evidenceItems.map((item) => {
              const safeUrl = safeExternalUrl(item.url);
              const title = safeUrl
                ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>`
                : escapeHtml(item.title);
              return `
                <li>
                  <h3>${title}</h3>
                  <p>${escapeHtml(item.summary || "")}</p>
                  <span>${escapeHtml(item.source || "公开来源")} · ${escapeHtml(item.sourceAuthorityLabel || "")} · ${formatDate(item.publishedAt)} · ${Number(item.score || 0)}</span>
                </li>
              `;
            }).join("")}
          </ul>
        </article>
      `;
    }).join("");
  }

  async function init() {
    const data = await loadJson("src/data/events.json", FALLBACK_EVENTS);
    const meta = document.getElementById("events-meta");
    if (meta) {
      meta.textContent = `事件更新时间：${formatDate(data.generatedAt)}；共 ${Number(data.totalEvents || 0)} 个重点事件。`;
    }
    renderExplainedEvents(document.getElementById("events-list"), data);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
