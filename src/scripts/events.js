(function () {
  const FALLBACK_EVENTS = {
    generatedAt: "",
    totalEvents: 0,
    events: []
  };
  const EVENT_REFRESH_MS = 120000;

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

  function itemDetailUrl(item) {
    const id = String(item?.id || "").trim();
    if (id) return `article.html?id=${encodeURIComponent(id)}`;

    const url = safeExternalUrl(item?.url);
    return url ? `article.html?url=${encodeURIComponent(url)}` : "article.html";
  }

  function renderTextList(title, values, fallback) {
    const items = (values || []).filter(Boolean).slice(0, 4);
    return `
      <section>
        <h3>${escapeHtml(title)}</h3>
        <ul>
          ${(items.length ? items : [fallback]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>
    `;
  }

  function renderMarketContext(marketContext) {
    const context = marketContext || {};
    const symbols = Object.entries(context.symbols || {}).slice(0, 6);
    if (!symbols.length && !(context.tickers || []).length) {
      return `<p>${context.status === "unconfigured" ? "行情未配置：缺少 ALPHA_VANTAGE_API_KEY。" : "暂无可展示行情数据。"}</p>`;
    }
    const rows = symbols.length
      ? symbols.map(([symbol, quote]) => `<span class="event-market-chip">${escapeHtml(symbol)} ${escapeHtml(quote.price || "")} ${escapeHtml(quote.changePercent || "")}</span>`).join("")
      : (context.tickers || []).map((symbol) => `<span class="event-market-chip">${escapeHtml(symbol)}</span>`).join("");
    return `
      <div class="event-market-row">${rows}</div>
      <p>${escapeHtml(context.stale ? "行情可能过期，交易前需核对实时价格。" : `行情时间：${context.generatedAt || "未知"}`)}</p>
    `;
  }

  function renderEvents(container, data) {
    if (!container) return;
    const events = data.events || [];
    if (!events.length) {
      container.innerHTML = `
        <div class="empty-state">
          <strong>暂无满足决策简报门槛的重点事件</strong>
          <p>当前只展示美股变化、中美 AI 发展、中国权威政策落地三条主线中证据足够的事件；缺少 ticker、行情、权威来源或交叉验证时会暂时降级为普通信息。</p>
        </div>
      `;
      return;
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
              ? `<a href="${escapeHtml(itemDetailUrl(item))}">${escapeHtml(item.title)}</a>`
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
      container.innerHTML = `
        <div class="empty-state">
          <strong>暂无满足决策简报门槛的重点事件</strong>
          <p>当前只展示美股变化、中美 AI 发展、中国权威政策落地三条主线中证据足够的事件；缺少 ticker、行情、权威来源或交叉验证时会暂时降级为普通信息。</p>
        </div>
      `;
      return;
      window.MessageChooseRender.renderEmptyState(container, {
        title: "暂无可追踪的重点事件",
        detail: "事件页只展示至少包含两条相关信息的聚合主题，信息流更新后会自动生成。"
      });
      return;
    }

    container.innerHTML = events.map((event) => {
      const evidenceItems = event.evidenceItems || event.items || [];
      const timeline = event.timeline || evidenceItems;
      const latest = event.latestUpdate || evidenceItems[0] || {};
      const latestUrl = safeExternalUrl(latest.url);
      const latestTitle = latestUrl
        ? `<a href="${escapeHtml(itemDetailUrl(latest))}">${escapeHtml(latest.title || "")}</a>`
        : escapeHtml(latest.title || "");
      return `
        <article class="event-card">
          <div class="event-card-head">
            <div>
              <div class="event-decision-meta">
                <span>${escapeHtml(event.decisionLaneLabel || "决策简报")}</span>
                <span>${escapeHtml(event.decisionGrade || "B")}级</span>
                <span>${escapeHtml(event.decisionSignal || "观察验证")}</span>
                <span>${escapeHtml(event.sourceQuality?.confidence || "medium")}</span>
              </div>
              ${event.decisionBrief ? `<p class="event-decision-brief">${escapeHtml(event.decisionBrief)}</p>` : ""}
              <h2>${escapeHtml(event.title || "重点事件")}</h2>
              <p>${escapeHtml(event.summary || "暂无事件摘要。")}</p>
            </div>
            <strong>${escapeHtml(event.heat || "中")}</strong>
          </div>
          <div class="event-latest-update">
            <strong>最新进展</strong>
            <h3>${latestTitle}</h3>
            <p>${escapeHtml(latest.summary || "")}</p>
            <span>来源：${escapeHtml(latest.source || event.primarySource || "公开来源")} · 发布时间：${escapeHtml(formatDate(latest.publishedAt || event.updatedAt))} · 来源数：${Number(event.sourceCount || event.sources?.length || 0)}</span>
          </div>
          <div class="event-explainer-grid event-decision-grid">
            <section>
              <h3>现在怎么处理</h3>
              <p>${escapeHtml(event.decisionBrief || "纳入观察，先核对原文和后续市场反应。")}</p>
            </section>
            <section>
              <h3>行情/市场相关</h3>
              ${renderMarketContext(event.marketContext)}
            </section>
            ${renderTextList("确认事实", event.confirmedFacts, "暂无足够确认事实，建议打开证据原文核对。")}
            <section>
              <h3>政策落地状态</h3>
              <p>${escapeHtml(event.policyStatus || event.marketRelevance || "非政策落地主线，关注后续官方发布和市场反应。")}</p>
            </section>
            ${renderTextList("风险与不确定性", event.riskFactors, "后续执行细节和市场反应仍需继续跟踪。")}
            ${renderTextList("证据缺口", event.evidenceGaps, "继续观察后续官方发布和价格反应是否一致。")}
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
          <h3 class="event-evidence-title">时间线</h3>
          <ol class="event-timeline">
            ${(event.keyDevelopments || timeline).map((item) => {
              const safeUrl = safeExternalUrl(item.url);
              const title = safeUrl
                ? `<a href="${escapeHtml(itemDetailUrl(item))}">${escapeHtml(item.title)}</a>`
                : escapeHtml(item.title);
              return `
                <li>
                  <time>${escapeHtml(formatDate(item.publishedAt || item.date))}</time>
                  <div>
                    <h3>${title}</h3>
                    <p>${escapeHtml(item.summary || "")}</p>
                    <span>${escapeHtml(item.source || "公开来源")} · ${Number(item.score || 0)}</span>
                  </div>
                </li>
              `;
            }).join("")}
          </ol>
          <h3 class="event-evidence-title">证据条目</h3>
          <ul class="event-item-list">
            ${evidenceItems.map((item) => {
              const safeUrl = safeExternalUrl(item.url);
              const title = safeUrl
                ? `<a href="${escapeHtml(itemDetailUrl(item))}">${escapeHtml(item.title)}</a>`
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

  function updateMeta(data) {
    const meta = document.getElementById("events-meta");
    if (meta) {
      meta.textContent = `事件更新时间：${formatDate(data.generatedAt)}；自动刷新：2分钟；回看近 ${Number(data.lookbackDays || 90)} 天；共 ${Number(data.totalEvents || 0)} 个重点事件。`;
    }
  }

  async function init() {
    const data = await loadJson("src/data/events.json", FALLBACK_EVENTS);
    updateMeta(data);
    renderExplainedEvents(document.getElementById("events-list"), data);
    if (window.location.protocol !== "file:") {
      setInterval(async () => {
        const refreshed = await loadJson("src/data/events.json", FALLBACK_EVENTS);
        if (refreshed.generatedAt && refreshed.generatedAt !== data.generatedAt) {
          data.generatedAt = refreshed.generatedAt;
          data.totalEvents = refreshed.totalEvents;
          data.lookbackDays = refreshed.lookbackDays;
          data.events = refreshed.events || [];
          updateMeta(data);
          renderExplainedEvents(document.getElementById("events-list"), data);
        }
      }, EVENT_REFRESH_MS);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
