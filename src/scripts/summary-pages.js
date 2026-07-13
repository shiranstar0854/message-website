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
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function sentence(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return /[。！？!?；;.]$/.test(text) ? text : `${text}。`;
  }

  function dailyArticleParagraphs(data) {
    const rows = [];
    (data.core_events || []).forEach((event) => {
      const opening = event.title
        ? `关于“${event.title}”，${event.core_fact || ""}`
        : event.core_fact;
      const text = [
        sentence(opening),
        event.current_progress ? sentence(`目前，${event.current_progress}`) : "",
        event.why_important ? sentence(`这件事的重要性在于${event.why_important}`) : ""
      ].join("");
      if (text) rows.push(text);
    });

    const keyData = (data.key_data || []).map((entry) => {
      const comparison = entry.comparison ? `，比较基准为${entry.comparison}` : "";
      const meaning = entry.meaning ? `，这意味着${entry.meaning}` : "";
      return `${entry.metric || "相关指标"}为${entry.value || "未披露"}${comparison}${meaning}`;
    }).filter(Boolean);
    if (keyData.length) rows.push(sentence(`数据方面，${keyData.join("；")}`));

    (data.cross_event_links || []).forEach((entry) => {
      const chain = (entry.logic_chain || []).filter(Boolean).join("，继而");
      const text = [chain ? sentence(`从事件之间的关系看，${chain}`) : "", sentence(entry.interpretation)].join("");
      if (text) rows.push(text);
    });

    const impacts = data.main_impacts || {};
    const impactText = [
      impacts.short_term ? sentence(`短期内，${impacts.short_term}`) : "",
      impacts.medium_long_term ? sentence(`从中长期看，${impacts.medium_long_term}`) : "",
      impacts.affected_groups?.length ? sentence(`主要受影响群体包括${impacts.affected_groups.join("、")}`) : ""
    ].join("");
    if (impactText) rows.push(impactText);

    (data.risk_alerts || []).forEach((entry) => {
      const text = [
        sentence(`当前仍需警惕${entry.risk || "信息不完整带来的判断偏差"}`),
        entry.basis ? sentence(`这一判断的依据是${entry.basis}`) : "",
        entry.uncertainty ? sentence(`不确定性在于${entry.uncertainty}`) : ""
      ].join("");
      if (text) rows.push(text);
    });

    (data.follow_up_watch || []).forEach((entry) => {
      const text = [
        sentence(`接下来需要在${entry.time_window || "后续公开进展中"}观察${entry.variable || "相关变量"}`),
        entry.confirmation_condition ? sentence(`若${entry.confirmation_condition}，可视为当前趋势得到确认`) : "",
        entry.invalidation_condition ? sentence(`若${entry.invalidation_condition}，则当前判断需要修正`) : "",
        entry.evidence_needed?.length ? sentence(`核验所需证据包括${entry.evidence_needed.join("、")}`) : ""
      ].join("");
      if (text) rows.push(text);
    });

    (data.tomorrow_focus || []).forEach((entry) => {
      rows.push(sentence(`近期明确日程中，${entry.item || "相关事项"}预计在${entry.expected_time || "待确认时间"}出现进展，之所以值得关注，是因为${entry.why_it_matters || "其结果可用于验证当前判断"}`));
    });
    return rows;
  }

  function paragraphs(values, formatter = (value) => value) {
    return (Array.isArray(values) ? values : []).map((value) => `<p>${escapeHtml(formatter(value))}</p>`).join("");
  }

  function renderDailySummary() {
    const meta = document.getElementById("daily-meta");
    const title = document.getElementById("daily-article-title");
    const lead = document.getElementById("daily-article-lead");
    const body = document.getElementById("daily-article-body");
    const sources = document.getElementById("daily-article-sources");
    const limitations = document.getElementById("daily-article-limitations");
    loadJson("src/data/daily-summary.json", null).then((data) => {
      if (!data || data.schema_version !== "daily-brief.v6") {
        title.textContent = "今日简报尚未生成";
        meta.textContent = "等待 daily-brief.v6 数据";
        body.innerHTML = '<p class="daily-article-empty">当前没有可展示的新版本每日摘要。</p>';
        return;
      }
      title.textContent = data.daily_thesis?.headline || "每日摘要";
      meta.textContent = `${data.date || ""} · 更新于 ${formatDate(data.updated_at)}`;
      lead.textContent = data.daily_thesis?.summary || "";
      body.innerHTML = dailyArticleParagraphs(data).map((text) => `<p>${escapeHtml(text)}</p>`).join("");
      const sourceLinks = (data.sources || []).map((source) => {
        const safeUrl = window.MessageChooseRender.safeExternalUrl(source.url);
        return safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a>` : `<span>${escapeHtml(source.name)}</span>`;
      }).join("");
      if (sourceLinks) {
        sources.hidden = false;
        sources.querySelector(".daily-source-list").innerHTML = sourceLinks;
      }
      if (data.limitations?.length) {
        limitations.hidden = false;
        limitations.querySelector("p").textContent = data.limitations.join("；");
      }
    });
  }

  function renderWeeklyReviewPage() {
    const meta = document.getElementById("weekly-meta");
    const summary = document.getElementById("weekly-model-summary");
    const container = document.getElementById("weekly-review");
    loadJson("src/data/weekly-review.json", null).then((review) => {
      if (!review || review.schema_version !== "weekly-review.v3") {
        meta.textContent = "等待 weekly-review.v3 数据";
        summary.textContent = "";
        window.MessageChooseRender.renderEmptyState(container, { title: "暂无新版每周复盘" });
        return;
      }
      meta.textContent = `${review.week_range?.start || ""} 至 ${review.week_range?.end || ""} · 更新于 ${formatDate(review.updated_at)}`;
      window.MessageChooseRender.renderWeeklyReview(container, summary, review);
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
        window.MessageChooseRender.renderEmptyState(feed, { title: "暂无历史归档", detail: "每日归档生成后会显示在这里。" });
        return;
      }
      dayList.innerHTML = index.days.map((day, dayIndex) => `<button class="history-day-button" type="button" data-index="${dayIndex}" aria-pressed="${dayIndex === 0}"><strong>${escapeHtml(day.date)}</strong><span>${Number(day.totalItems || 0)} 条</span></button>`).join("");
      dayList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-index]");
        if (button) selectDay(index.days[Number(button.dataset.index)], button);
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
