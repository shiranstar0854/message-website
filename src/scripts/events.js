(function () {
  const FALLBACK_EVENTS = {
    generatedAt: "",
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

  function eventDetailUrl(event) {
    const id = String(event?.event_id || event?.id || "").trim();
    return id ? `event.html?id=${encodeURIComponent(id)}` : "events.html";
  }

  function renderTextList(title, values, fallback) {
    const items = (values || []).filter(Boolean).slice(0, 4);
    const itemText = (item) => {
      if (item && typeof item === "object") {
        return item.fact || item.variable || item.risk || item.uncertainty || item.argument || item.question || item.title || item.summary || "";
      }
      return item;
    };
    return `
      <section>
        <h3>${escapeHtml(title)}</h3>
        <ul>
          ${(items.length ? items : [fallback]).map((item) => `<li>${escapeHtml(itemText(item))}</li>`).join("")}
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
          <strong>${Number(event.profile?.related_item_count || event.related_items?.length || 0)} 条</strong>
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
      const detailUrl = eventDetailUrl(event);
      const evidenceItems = event.related_items || [];
      const timeline = event.timeline || evidenceItems;
      const latest = event.latest_update || evidenceItems[0] || {};
      const latestUrl = safeExternalUrl(latest.url);
      const latestTitle = latestUrl
        ? `<a href="${escapeHtml(itemDetailUrl(latest))}">${escapeHtml(latest.title || "")}</a>`
        : escapeHtml(latest.title || "");
      const decision = event.decision || {};
      const definition = event.definition || {};
      const evidence = event.evidence || {};
      const profile = event.profile || {};
      const currentJudgment = event.current_judgment || {};
      return `
        <article class="event-card">
          <div class="event-card-head">
            <div>
              <div class="event-decision-meta">
                <span>${escapeHtml(event.lane_label || "决策简报")}</span>
                <span>${escapeHtml(event.priority_grade || "B")}级</span>
                <span>${escapeHtml(decision.signal || "观察验证")}</span>
                <span>${escapeHtml(evidence.confidence_basis || "medium")}</span>
              </div>
              ${decision.brief ? `<p class="event-decision-brief">${escapeHtml(decision.brief)}</p>` : ""}
              <h2>${escapeHtml(event.title || "重点事件")}</h2>
              <p>${escapeHtml(definition.one_sentence || "暂无事件摘要。")}</p>
            </div>
            <div class="event-card-actions">
              <strong>${escapeHtml(event.priority_grade || "中")}</strong>
              <a class="event-detail-button" href="${escapeHtml(detailUrl)}">查看追踪详情</a>
            </div>
          </div>
          <div class="event-latest-update">
            <strong>最新进展</strong>
            <h3>${latestTitle}</h3>
            <p>${escapeHtml(latest.summary || "")}</p>
            <span>来源：${escapeHtml(latest.source || evidence.primary_source?.name || "公开来源")} · 发布时间：${escapeHtml(formatDate(latest.published_at || event.updated_at))} · 来源数：${Number(evidence.source_count || 0)}</span>
          </div>
          <div class="event-explainer-grid event-decision-grid">
            <section>
            <h3>现在怎么处理</h3>
              <p>${escapeHtml(decision.brief || currentJudgment.summary || "纳入观察，先核对原文和后续市场反应。")}</p>
            </section>
            <section>
              <h3>行情/市场相关</h3>
              ${renderMarketContext({ tickers: decision.market_symbols || [], status: decision.market_symbols?.length ? "available" : "missing" })}
            </section>
            ${renderTextList("确认事实", event.confirmed_facts, "暂无足够确认事实，建议打开证据原文核对。")}
            <section>
              <h3>政策落地状态</h3>
              <p>${escapeHtml(decision.policy_status || "非政策落地主线，关注后续官方发布和市场反应。")}</p>
            </section>
            ${renderTextList("风险与不确定性", event.risks, "后续执行细节和市场反应仍需继续跟踪。")}
            ${renderTextList("证据缺口", event.evidence?.evidence_gaps, "继续观察后续官方发布和价格反应是否一致。")}
          </div>
          <div class="event-explainer-grid">
            <section>
              <h3>为什么重要</h3>
              <p>${escapeHtml(definition.why_it_matters || "该事件可能影响政策、市场、产业或国际变化判断。")}</p>
            </section>
            <section>
              <h3>接下来关注</h3>
              <ul>
                ${(event.watch_variables || ["关注后续官方发布和市场反应"]).slice(0, 3).map((item) => `<li>${escapeHtml(item.variable || item)}</li>`).join("")}
              </ul>
            </section>
          </div>
          <div class="tag-row" aria-label="影响范围">
            ${(profile.impact_areas || []).slice(0, 6).map((keyword) => `<span class="tag">${escapeHtml(keyword)}</span>`).join("")}
          </div>
          <h3 class="event-evidence-title">时间线</h3>
          <ol class="event-timeline">
            ${timeline.map((item) => {
              const safeUrl = safeExternalUrl(item.url);
              const title = safeUrl
                ? `<a href="${escapeHtml(itemDetailUrl(item))}">${escapeHtml(item.title)}</a>`
                : escapeHtml(item.title);
              return `
                <li>
                  <time>${escapeHtml(formatDate(item.published_at || item.publishedAt || item.date))}</time>
                  <div>
                    <h3>${title}</h3>
                    <p>${escapeHtml(item.summary || item.description || "")}</p>
                    <span>${escapeHtml(item.source || item.sources?.[0]?.source || "公开来源")} · ${Number(item.score || 0)}</span>
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
                  <span>${escapeHtml(item.source || "公开来源")} · ${formatDate(item.published_at || item.publishedAt)} · ${Number(item.relevance_score || item.score || 0)}</span>
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
      const generatedAt = data.generated_at || data.generatedAt;
      const lookbackDays = data.meta?.lookback_days || 90;
      const totalEvents = data.meta?.event_count || data.events?.length || 0;
      meta.textContent = `事件更新时间：${formatDate(generatedAt)}；自动刷新：2分钟；回看近 ${Number(lookbackDays)} 天；共 ${Number(totalEvents)} 个重点事件。`;
    }
  }

  async function init() {
    const data = await loadJson("src/data/events.json", FALLBACK_EVENTS);
    updateMeta(data);
    renderExplainedEvents(document.getElementById("events-list"), data);
    if (window.location.protocol !== "file:") {
      setInterval(async () => {
        const refreshed = await loadJson("src/data/events.json", FALLBACK_EVENTS);
        const refreshedGeneratedAt = refreshed.generated_at || refreshed.generatedAt;
        const currentGeneratedAt = data.generated_at || data.generatedAt;
        if (refreshedGeneratedAt && refreshedGeneratedAt !== currentGeneratedAt) {
          data.generated_at = refreshed.generated_at;
          data.events = refreshed.events || [];
          updateMeta(data);
          renderExplainedEvents(document.getElementById("events-list"), data);
        }
      }, EVENT_REFRESH_MS);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
