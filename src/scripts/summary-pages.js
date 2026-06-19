(function () {
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

  function sourceName(item) {
    return item.source?.name || item.source || "";
  }

  function itemScore(item) {
    return Number(item.quality?.score || item.importance_score || item.score || 0);
  }

  function itemKeyPoints(item) {
    if (Array.isArray(item.summary?.key_points)) return item.summary.key_points;
    if (Array.isArray(item.summary_points)) return item.summary_points;
    return [];
  }

  function itemSummaryText(item) {
    return item.summary?.one_sentence || item.summary_short || item.aiSummary || item.summary || "";
  }

  function channelOverview(channel) {
    return channel.thinking_brief?.surface_summary || channel.overview || "";
  }

  function channelFocus(channel) {
    return channel.thinking_brief?.core_judgment || channel.focus || "";
  }

  function channelWhyItMatters(channel) {
    return channel.thinking_brief?.why_it_matters || channel.whyItMatters || "";
  }

  function channelKeyPoints(channel) {
    if (Array.isArray(channel.key_signals)) return channel.key_signals.map((item) => item.signal).filter(Boolean);
    return channel.keyPoints || [];
  }

  function channelWatchlist(channel) {
    return (channel.watch_variables || channel.watchlist || []).map((item) => item.variable || item).filter(Boolean);
  }

  function renderHighlight(item) {
    const detailUrl = window.MessageChooseRender.itemDetailUrl(item);
    const titleValue = item.title?.translated || item.title?.original || item.title || "";
    const title = `<a href="${escapeHtml(detailUrl)}">${escapeHtml(titleValue)}</a>`;
    const summary = itemSummaryText(item);
    const keyPoints = itemKeyPoints(item);
    const originalUrl = window.MessageChooseRender.safeExternalUrl(item.original_url || item.url);
    return `
      <article class="feed-card summary-card">
        <div>
          <h3>${title}</h3>
          ${window.MessageChooseRender.renderSummary(summary)}
          <div class="item-meta">
            <span>${escapeHtml(sourceName(item))}</span>
            <span>重要度 ${itemScore(item)}</span>
          </div>
          ${keyPoints.length ? `
            <ul class="daily-keypoints">
              ${keyPoints.slice(0, 3).map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
            </ul>
          ` : ""}
          <div class="feed-card-actions">
            <a class="summary-entry-link" href="${escapeHtml(detailUrl)}">详情摘要</a>
            ${originalUrl ? `<a class="original-entry" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">查看原文</a>` : ""}
          </div>
        </div>
      </article>
    `;
  }

  function groupSummaryItems(items) {
    const grouped = new Map();
    (items || []).forEach((item) => {
      if (!itemSummaryText(item)) return;
      const key = item.category || "news";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    });
    return [...grouped.entries()].map(([id, values]) => ({
      id,
      label: values[0]?.categoryLabel || id,
      items: values.sort((left, right) => itemScore(right) - itemScore(left))
    }));
  }

  function renderDailySummary() {
    const meta = document.getElementById("daily-meta");
    const container = document.getElementById("daily-summary-list");
    loadJson("src/data/daily-summary.json", { channels: [], channelSummaries: [], items: [] }).then((data) => {
      const channelSummaries = data.channels || data.channelSummaries || [];
      const summaryItems = data.items || [];
      const summaryItemsById = new Map(summaryItems.map((item) => [item.id, item]));
      const generatedAt = data.generated_at || data.generatedAt;
      meta.textContent = `摘要更新时间：${formatDate(generatedAt)} · ${Number(channelSummaries.length)} 类重点事务 · ${Number(summaryItems.length)} 条结构化摘要`;
      if (!channelSummaries.length && !summaryItems.length) {
        window.MessageChooseRender.renderEmptyState(container, {
          title: "暂无每日摘要",
          detail: "每日更新完成后会显示频道重点事务和文章结构化摘要。"
        });
        return;
      }

      const channelHtml = channelSummaries.map((channel) => {
        const keyPoints = channelKeyPoints(channel);
        const watchlist = channelWatchlist(channel);
        const highlights = channel.highlights || (channel.item_refs?.highlight_item_ids || [])
          .map((id) => summaryItemsById.get(id))
          .filter(Boolean);
        return `
          <article class="daily-brief-card">
            <div class="daily-brief-head">
              <h2>${escapeHtml(channel.label || channel.id)}</h2>
            </div>
            <p class="model-summary">${escapeHtml(channelOverview(channel))}</p>
            ${channelFocus(channel) ? `<p class="summary-focus">${escapeHtml(channelFocus(channel))}</p>` : ""}
            ${channelWhyItMatters(channel) ? `<p class="summary-explainer">${escapeHtml(channelWhyItMatters(channel))}</p>` : ""}
            ${keyPoints.length ? `
              <ul class="daily-keypoints">
                ${keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
              </ul>
            ` : ""}
            ${watchlist.length ? `
              <div class="weekly-watchlist">
                ${watchlist.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
              </div>
            ` : ""}
            ${highlights.length ? `
              <details class="daily-evidence">
                <summary>查看依据条目</summary>
                <div class="feed-list">
                  ${highlights.map(renderHighlight).join("")}
                </div>
              </details>
            ` : ""}
          </article>
        `;
      }).join("");

      const itemGroups = groupSummaryItems(summaryItems);
      const itemHtml = itemGroups.length ? `
        <section class="summary-group">
          <h2>文章结构化摘要</h2>
          ${itemGroups.map((group) => `
            <article class="daily-brief-card">
              <div class="daily-brief-head">
                <h2>${escapeHtml(group.label || group.id)}</h2>
              </div>
              <div class="feed-list">
                ${group.items.map(renderHighlight).join("")}
              </div>
            </article>
          `).join("")}
        </section>
      ` : "";

      container.innerHTML = `${channelHtml}${itemHtml}`;
    });
  }

  function renderWeeklyReviewPage() {
    const meta = document.getElementById("weekly-meta");
    const summary = document.getElementById("weekly-model-summary");
    const container = document.getElementById("weekly-review");
    loadJson("src/data/weekly-review.json", { channels: [], totals: {} }).then((review) => {
      meta.textContent = `${review.weekId || "本周"} · 覆盖 ${Number(review.totals?.archiveCount || 0)} 天归档`;
      summary.textContent = review.modelSummary || review.executiveSummary || "";
      window.MessageChooseRender.renderWeeklyReview(container, null, review);
    });
  }

  function renderHistory() {
    const meta = document.getElementById("history-meta");
    const dayList = document.getElementById("history-days");
    const title = document.getElementById("history-date-title");
    const dateMeta = document.getElementById("history-date-meta");
    const feed = document.getElementById("history-feed");

    function selectDay(day, button) {
      [...dayList.querySelectorAll("button")].forEach((candidate) => candidate.setAttribute("aria-pressed", "false"));
      button?.setAttribute("aria-pressed", "true");
      title.textContent = day.date;
      dateMeta.textContent = "正在加载归档";
      loadJson(day.url, { items: [] }).then((archive) => {
        dateMeta.textContent = `${formatDate(archive.generatedAt)} · ${Number(archive.items?.length || 0)} 条`;
        window.MessageChooseRender.renderFeed(feed, archive.items || []);
      });
    }

    loadJson("src/data/history-index.json", { days: [], retentionDays: 10 }).then((index) => {
      meta.textContent = `网页显示最近 ${Number(index.retentionDays || 10)} 天 · 当前 ${Number(index.totalDays || index.days.length || 0)} 天`;
      if (!index.days?.length) {
        window.MessageChooseRender.renderEmptyState(feed, {
          title: "暂无历史归档",
          detail: "每日归档生成后会显示在这里。"
        });
        return;
      }

      dayList.innerHTML = index.days.map((day, index) => `
        <button class="history-day-button" type="button" data-index="${index}" aria-pressed="${index === 0 ? "true" : "false"}">
          <strong>${escapeHtml(day.date)}</strong>
          <span>${Number(day.totalItems || 0)} 条</span>
        </button>
      `).join("");
      dayList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-index]");
        if (!button) return;
        selectDay(index.days[Number(button.dataset.index)], button);
      });
      selectDay(index.days[0], dayList.querySelector("[data-index='0']"));
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const page = document.body.dataset.page;
    if (page === "daily-summary") renderDailySummary();
    if (page === "weekly-review") renderWeeklyReviewPage();
    if (page === "history") renderHistory();
  });
})();
