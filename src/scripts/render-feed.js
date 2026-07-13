(function () {
  function escapeHtml(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
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

  function displayTitle(item) {
    return item.article_brief?.title || item.title_zh || item.titleZh || item.translatedTitle || item.title || "未命名信息";
  }

  function textSection(title, value, className = "") {
    const text = String(value || "").trim();
    if (!text) return "";
    return `<section class="brief-section ${className}"><h4>${escapeHtml(title)}</h4><p>${escapeHtml(text)}</p></section>`;
  }

  function listSection(title, values) {
    const rows = (Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean);
    if (!rows.length) return "";
    return `<section class="brief-section"><h4>${escapeHtml(title)}</h4>${rows.map((row) => `<p>${escapeHtml(row)}</p>`).join("")}</section>`;
  }

  function renderArticleBrief(item, compact = false, showDetailLink = true) {
    const brief = item.article_brief;
    const detailUrl = itemDetailUrl(item);
    const originalUrl = safeExternalUrl(item.original_url || item.url);
    if (!brief) {
      const fallback = item.summary_short || item.summary_zh || item.aiSummary || item.contentExcerpt || item.summary || "";
      return `${textSection("核心事实", fallback)}<p class="brief-limit">当前条目尚未生成 article-brief.v1，详情以原文为准。</p>`;
    }
    const keyData = (brief.key_data || []).map((entry) => [entry.label, entry.value, entry.context].filter(Boolean).join("："));
    const positions = (brief.stakeholder_positions || []).map((entry) => `${entry.party}：${entry.position}${entry.evidence ? `。依据：${entry.evidence}` : ""}`);
    const watches = (brief.watch_variables || []).map((entry) => `${entry.variable}。确认条件：${entry.confirmation_condition}。失效条件：${entry.invalidation_condition}`);
    const body = [
      textSection("核心事实", brief.core_fact?.summary, "brief-core"),
      compact ? "" : textSection("背景", brief.background),
      compact ? "" : listSection("关键数据", keyData),
      textSection("当前进展", brief.current_progress?.details),
      textSection("直接影响", brief.impact?.direct),
      compact ? "" : textSection("中长期影响", brief.impact?.medium_long_term),
      compact ? "" : listSection("各方态度", positions),
      compact ? "" : textSection("后续趋势", brief.outlook),
      compact ? "" : listSection("风险与不确定性", brief.risks_and_uncertainties),
      compact ? "" : listSection("观察变量", watches)
    ].join("");
    return `${body}<div class="brief-actions">${showDetailLink ? `<a href="${escapeHtml(detailUrl)}">阅读全文</a>` : ""}${originalUrl ? `<a href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">查看原文</a>` : ""}</div>`;
  }

  function renderFeed(container, items) {
    if (!items.length) {
      renderEmptyState(container, { title: "当前筛选条件下没有可展示的信息。" });
      return;
    }
    container.innerHTML = items.map((item) => `
      <article class="feed-article">
        <header class="feed-article-header">
          <p class="feed-byline">${escapeHtml(item.source || "公开来源")} · ${escapeHtml(formatDate(item.publishedAt))}</p>
          <h3><a href="${escapeHtml(itemDetailUrl(item))}">${escapeHtml(displayTitle(item))}</a></h3>
        </header>
        <div class="feed-article-body">${renderArticleBrief(item)}</div>
      </article>
    `).join("");
  }

  function renderChannelSummary(container, data) {
    container.innerHTML = Object.values(data.channels || {}).map((channel) => `<div class="metric-tile"><strong>${Number(channel.count || channel.items?.length || 0)}</strong><span>${escapeHtml(channel.label)}频道</span></div>`).join("");
  }

  function renderSummary(value) {
    const text = String(value || "").trim();
    return text ? `<p>${escapeHtml(text)}</p>` : "";
  }

  function weeklyRows(title, values, formatter) {
    const rows = Array.isArray(values) ? values : [];
    if (!rows.length) return "";
    return `<section class="weekly-article-section"><h2>${escapeHtml(title)}</h2>${rows.map((row) => `<div class="weekly-entry">${formatter(row)}</div>`).join("")}</section>`;
  }

  function renderWeeklyReview(container, summaryContainer, review) {
    if (!review || review.schema_version !== "weekly-review.v3") {
      container.innerHTML = '<div class="empty-state">暂无 weekly-review.v3 周报。</div>';
      if (summaryContainer) summaryContainer.textContent = "周报数据尚未生成";
      return;
    }
    if (summaryContainer) summaryContainer.textContent = review.weekly_thesis || "";
    const validation = review.previous_week_validation || {};
    const personal = review.personal_implications || {};
    container.innerHTML = `
      <section class="weekly-article-section"><h2>本周核心结论</h2><p>${escapeHtml(review.weekly_thesis)}</p></section>
      ${weeklyRows("本周重大事件", review.major_events, (row) => `<h3>${escapeHtml(row.title)}</h3><p>${escapeHtml(row.what_happened)}</p><p>${escapeHtml(row.why_important)}</p><p>${escapeHtml(row.current_progress)}</p>`)}
      ${weeklyRows("主题与趋势变化", review.category_trends, (row) => `<h3>${escapeHtml(row.theme)}</h3><p>${escapeHtml(row.conclusion)}</p><p>${escapeHtml(row.change_from_previous_week)}</p><p>信号：${escapeHtml(row.signal?.level || "unconfirmed")}。${escapeHtml(row.signal?.reason || "")}</p>`)}
      ${weeklyRows("关键数据对比", review.key_data_changes, (row) => `<p><strong>${escapeHtml(row.metric)}</strong>：${escapeHtml(row.current_value)}；比较基准：${escapeHtml(row.comparison_baseline)}；变化：${escapeHtml(row.change)}。${escapeHtml(row.meaning)}</p>`)}
      ${weeklyRows("事件关联与主线", review.cross_event_links, (row) => `<p>${escapeHtml((row.logic_chain || []).join(" → "))}</p><p>${escapeHtml(row.interpretation)}</p>`)}
      ${weeklyRows("市场和政策反馈", review.market_policy_feedback, (row) => `<p>${escapeHtml([row.market_feedback, row.policy_feedback].filter(Boolean).join(" "))}</p>`)}
      ${weeklyRows("上周判断验证", [...(validation.verified || []), ...(validation.pending || []), ...(validation.falsified || []), ...(validation.deviated || [])], (row) => `<p><strong>${escapeHtml(row.judgment_id)}</strong>：${escapeHtml(row.reason)}</p>`)}
      ${weeklyRows("认知修正", review.cognitive_updates, (row) => `<p>原判断：${escapeHtml(row.previous_judgment)}</p><p>新判断：${escapeHtml(row.updated_judgment)}</p><p>修正原因：${escapeHtml(row.reason)}</p>`)}
      ${weeklyRows("新增信号", review.new_signals, (row) => `<p><strong>${escapeHtml(row.signal)}</strong> · ${escapeHtml(row.level)}。${escapeHtml(row.reason)}</p>`)}
      ${weeklyRows("风险与分歧", review.risks_and_uncertainties, (row) => `<p>${escapeHtml(row.risk || row)}</p>`)}
      <section class="weekly-article-section"><h2>对个人的实际影响</h2>${Object.values(personal).flat().map((row) => `<p>${escapeHtml(row)}</p>`).join("") || "<p>本周没有足够证据形成具体影响判断。</p>"}</section>
      ${weeklyRows("下周观察重点", review.next_week_watchlist, (row) => `<h3>${escapeHtml(row.observation)}</h3><p>强化条件：${escapeHtml(row.confirmation_condition)}</p><p>失效条件：${escapeHtml(row.invalidation_condition)}</p><p>所需证据：${escapeHtml((row.evidence_needed || []).join("、"))}</p>`)}
      ${listSection("数据限制", review.limitations)}
    `;
  }

  function renderEmptyState(container, state) {
    const actions = state.actions || [];
    container.innerHTML = `<div class="empty-state"><h3>${escapeHtml(state.title || "没有匹配结果")}</h3>${state.detail ? `<p>${escapeHtml(state.detail)}</p>` : ""}${actions.map((action) => `<button class="ghost-button" type="button" data-empty-action="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`).join("")}</div>`;
  }

  window.MessageChooseRender = { formatDate, renderChannelSummary, renderEmptyState, renderFeed, renderWeeklyReview, renderSummary, safeExternalUrl, itemDetailUrl, renderArticleBrief };
})();
