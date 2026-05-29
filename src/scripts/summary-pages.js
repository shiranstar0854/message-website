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

  function renderHighlight(item) {
    const safeUrl = window.MessageChooseRender.safeExternalUrl(item.url);
    const title = safeUrl
      ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>`
      : escapeHtml(item.title);
    return `
      <article class="feed-card summary-card">
        <div>
          <h3>${title}</h3>
          ${window.MessageChooseRender.renderSummary(item.summary)}
          <div class="item-meta">
            <span>${escapeHtml(item.source)}</span>
            <span>${Number(item.score || 0)}</span>
          </div>
        </div>
      </article>
    `;
  }

  function renderDailySummary() {
    const meta = document.getElementById("daily-meta");
    const container = document.getElementById("daily-summary-list");
    loadJson("src/data/daily-summary.json", { channelSummaries: [] }).then((data) => {
      const channelSummaries = data.channelSummaries || [];
      meta.textContent = `摘要更新时间：${formatDate(data.generatedAt)} · ${Number(channelSummaries.length)} 类重点事务 · ${data.method || "extractive"}`;
      if (!channelSummaries.length) {
        window.MessageChooseRender.renderEmptyState(container, {
          title: "暂无每日摘要",
          detail: "每日更新完成后会显示科技、金融、新闻三类重点事务。"
        });
        return;
      }

      container.innerHTML = channelSummaries.map((channel) => `
        <article class="daily-brief-card">
          <div class="daily-brief-head">
            <h2>${escapeHtml(channel.label || channel.id)}</h2>
            <span>${escapeHtml(channel.summaryMethod || data.method || "extractive")}</span>
          </div>
          <p class="model-summary">${escapeHtml(channel.overview || "")}</p>
          ${(channel.keyPoints || []).length ? `
            <ul class="daily-keypoints">
              ${(channel.keyPoints || []).map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
            </ul>
          ` : ""}
          ${(channel.highlights || []).length ? `
            <details class="daily-evidence">
              <summary>查看依据条目</summary>
              <div class="feed-list">
                ${(channel.highlights || []).map(renderHighlight).join("")}
              </div>
            </details>
          ` : ""}
        </article>
      `).join("");
    });
  }

  function renderWeeklyReviewPage() {
    const meta = document.getElementById("weekly-meta");
    const summary = document.getElementById("weekly-model-summary");
    const container = document.getElementById("weekly-review");
    loadJson("src/data/weekly-review.json", { channels: [], totals: {} }).then((review) => {
      meta.textContent = `${review.weekId || "本周"} · 覆盖 ${Number(review.totals?.archiveCount || 0)} 天归档 · ${review.method || "extractive"}`;
      summary.textContent = review.modelSummary || "当前周报使用本地规则生成；配置 DeepSeek 后会显示模型生成的总览。";
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
      meta.textContent = `保留最近 ${Number(index.retentionDays || 10)} 天 · 当前 ${Number(index.totalDays || index.days.length || 0)} 天`;
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
