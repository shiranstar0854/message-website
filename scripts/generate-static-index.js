const fs = require("node:fs");
const path = require("node:path");
const { readJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(ROOT_DIR, "index.html");
const START_MARKER = "<!-- STATIC_SUMMARY_START -->";
const END_MARKER = "<!-- STATIC_SUMMARY_END -->";

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
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function selectTopHotspots(items, limit = 5) {
  const seenKeys = new Set();
  return [...(items || [])]
    .filter((item) => !["C", "D"].includes(String(item.sourceTier || "").toUpperCase()))
    .sort((left, right) => hotspotRankScore(right) - hotspotRankScore(left)
      || Number(right.importance_score || right.score || 0) - Number(left.importance_score || left.score || 0)
      || new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime())
    .filter((item) => {
      const key = hotspotEventKey(item);
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    })
    .slice(0, limit);
}

function channelLabel(channels, category) {
  return channels?.[category]?.label || category || "新闻";
}

function isEnglishSourceItem(item) {
  return item.source_language === "en" || item.sourceLanguage === "en" || (/^[\x00-\x7F\s.,:'"!?()-]+$/.test(`${item.title || ""} ${item.summary || ""}`) && /[A-Za-z]/.test(item.title || ""));
}

function itemDetailUrl(item) {
  const id = String(item?.id || "").trim();
  if (id) return `article.html?id=${encodeURIComponent(id)}`;

  const url = String(item?.url || "").trim();
  return url ? `article.html?url=${encodeURIComponent(url)}` : "article.html";
}

function displayTitle(item) {
  return item.title_zh || item.titleZh || item.translatedTitle || item.title || "未命名信息";
}

function shortExplanation(item) {
  const text = item.summary_short || item.summary_zh || item.summaryZh || item.aiSummary || item.contentExcerpt || item.summary || item.summary_original || "暂无摘要。";
  return text.length > 86 ? `${text.slice(0, 83).trimEnd()}...` : text;
}

function importanceText(item) {
  return item.why_it_matters || item.importance || item.summaryReason || `重要度 ${Number(item.importance_score || item.score || 0)}，来自${item.source || "公开来源"}。`;
}

function impactAreas(item, channels = {}) {
  const areas = item.impactAreas?.length
    ? item.impactAreas
    : (item.article_keywords || item.keywords || item.tags || []).slice(0, 4);
  return areas.length ? areas : [channelLabel(channels, item.category)];
}

function hotspotTags(item, channels = {}) {
  return impactAreas(item, channels).slice(0, 2);
}

function hotspotEventKey(item) {
  const keywords = (item.impactAreas || item.article_keywords || item.keywords || item.tags || []).slice(0, 2).join("|").toLowerCase();
  return keywords || String(displayTitle(item)).toLowerCase().slice(0, 24);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hasUsefulText(value) {
  const text = String(value || "").trim();
  return Boolean(text && !/不足以判断|暂无|unknown/i.test(text));
}

function textPool(item) {
  return [
    item.title,
    item.title_zh,
    item.summary,
    item.summary_zh,
    item.summary_short,
    item.aiSummary,
    item.why_it_matters,
    item.impact,
    item.risks,
    ...(item.article_keywords || []),
    ...(item.keywords || []),
    ...(item.impactAreas || []),
    ...(item.tags || [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function sourceTrustScore(item) {
  const preset = numberOrNull(item.source_trust_score);
  if (preset !== null) return clampScore(preset);
  if (item.sourceTier === "S") return 96;
  if (item.sourceTier === "A") return 86;
  if (item.sourceTier === "B") return 72;
  if (item.sourceTier === "C") return 35;
  if (item.sourceTier === "D") return 10;
  const authority = item.sourceAuthority || item.sourceType;
  if (["official-agency", "official-market"].includes(authority)) return 94;
  if (authority === "official-media") return 88;
  if (authority === "financial-media") return 78;
  if (authority === "media" || authority === "webpage" || authority === "rss") return 68;
  return clampScore(Number(item.credibility || 60));
}

function multiSourceScore(item) {
  const preset = numberOrNull(item.multi_source_score);
  if (preset !== null) return clampScore(preset);
  const duplicateCount = Number(item.duplicateCount || 0);
  const sourceBonus = ["official-agency", "official-market", "official-media"].includes(item.sourceAuthority) ? 10 : 0;
  return clampScore(45 + Math.min(40, duplicateCount * 14) + sourceBonus);
}

function eventImpactScore(item) {
  const preset = numberOrNull(item.event_impact_score);
  if (preset !== null) return clampScore(preset);
  const impactAreas = item.impactAreas || [];
  const keyData = item.key_data || [];
  const base = Number(item.importance_score || item.score || 0);
  const relevance = numberOrNull(item.event_relevance_score);
  const explanationBonus = hasUsefulText(item.why_it_matters) || hasUsefulText(item.impact) || hasUsefulText(item.importance) ? 8 : 0;
  return clampScore(Math.max(base, relevance || 0, 52 + Math.min(24, impactAreas.length * 8) + Math.min(12, keyData.length * 4) + explanationBonus));
}

function marketFeedbackScore(item) {
  const preset = numberOrNull(item.market_feedback_score);
  if (preset !== null) return clampScore(preset);
  const pool = textPool(item);
  let score = 35;
  if (["finance", "business", "macro"].includes(item.category || item.primaryCategory)) score += 18;
  if (/market|stock|share|股价|成交|市场|利率|通胀|监管|政策|开发者|官方回应/.test(pool)) score += 22;
  if ((item.key_data || []).length) score += 12;
  if (Number(item.duplicateCount || 0) > 0) score += 8;
  return clampScore(score);
}

function followUpValueScore(item) {
  const preset = numberOrNull(item.follow_up_value_score);
  if (preset !== null) return clampScore(preset);
  let score = 38;
  if (item.timeline_event_id) score += 24;
  if (hasUsefulText(item.risks)) score += 12;
  if (hasUsefulText(item.why_it_matters) || hasUsefulText(item.impact)) score += 14;
  if (hasUsefulText(item.importance) || hasUsefulText(item.summaryReason)) score += 8;
  if (hasUsefulText(item.summary_short) || hasUsefulText(item.aiSummary) || hasUsefulText(item.contentExcerpt)) score += 8;
  if ((item.summary_points || []).length >= 2) score += 6;
  if ((item.impactAreas || []).length >= 2) score += 6;
  return clampScore(score);
}

function freshnessScore(item) {
  const preset = numberOrNull(item.freshness_score);
  if (preset !== null) return clampScore(preset);
  const publishedTime = new Date(item.publishedAt || item.fetchedAt || 0).getTime();
  if (Number.isNaN(publishedTime)) return 35;
  const ageHours = Math.max(0, (Date.now() - publishedTime) / (60 * 60 * 1000));
  if (ageHours <= 6) return 100;
  if (ageHours <= 24) return clampScore(92 - ageHours * 1.5);
  if (ageHours <= 72) return clampScore(62 - (ageHours - 24) * 0.8);
  return 20;
}

function uncertaintyPenalty(item) {
  const preset = numberOrNull(item.uncertainty_penalty);
  if (preset !== null) return Math.max(0, preset);
  const confidence = String(item.confidence || "").toLowerCase();
  let penalty = confidence === "low" ? 14 : confidence === "medium" ? 6 : 0;
  if (/不足以判断|无法确认|未证实|传闻|rumor/.test(textPool(item))) penalty += 8;
  return penalty;
}

function duplicationPenalty(item) {
  const preset = numberOrNull(item.duplication_penalty);
  if (preset !== null) return Math.max(0, preset);
  return Math.min(8, Math.max(0, Number(item.duplicateCount || 0) - 2) * 2);
}

function clickbaitPenalty(item) {
  const preset = numberOrNull(item.clickbait_penalty);
  if (preset !== null) return Math.max(0, preset);
  return /震惊|爆炸|史诗级|重磅突发|必看|狂飙|!{2,}|？{2,}|\?{2,}/.test(String(item.title || "")) ? 10 : 0;
}

function topScoreBreakdown(item) {
  const preset = numberOrNull(item.top_score);
  const source = sourceTrustScore(item);
  const multi = multiSourceScore(item);
  const impact = eventImpactScore(item);
  const market = marketFeedbackScore(item);
  const followUp = followUpValueScore(item);
  const freshness = freshnessScore(item);
  const uncertainty = uncertaintyPenalty(item);
  const duplication = duplicationPenalty(item);
  const clickbait = clickbaitPenalty(item);
  const relevance = numberOrNull(item.event_relevance_score);
  const lowRelevancePenalty = relevance !== null && relevance < 45 ? 12 : 0;
  const computed = source * 0.20
    + multi * 0.20
    + impact * 0.20
    + market * 0.15
    + followUp * 0.15
    + freshness * 0.10
    - uncertainty
    - duplication
    - clickbait
    - lowRelevancePenalty;

  return {
    source_trust_score: source,
    multi_source_score: multi,
    event_impact_score: impact,
    market_feedback_score: market,
    follow_up_value_score: followUp,
    freshness_score: freshness,
    uncertainty_penalty: uncertainty,
    duplication_penalty: duplication,
    clickbait_penalty: clickbait,
    event_relevance_penalty: lowRelevancePenalty,
    top_score: clampScore(preset !== null ? preset : computed)
  };
}

function hotspotRankScore(item) {
  return topScoreBreakdown(item).top_score;
}

function eventRankScore(event) {
  const updatedTime = new Date(event.last_updated || event.updatedAt || 0).getTime();
  const freshness = Number.isNaN(updatedTime) ? 0 : Math.max(0, 16 - (Date.now() - updatedTime) / (6 * 60 * 60 * 1000));
  const evidence = event.evidenceItems || event.items || [];
  const topScore = Number(evidence[0]?.score || 0);
  const explanationBonus = (event.whyItMatters || event.impact_analysis ? 8 : 0)
    + ((event.watchlist || event.watch_variables)?.length ? 5 : 0)
    + ((event.impactAreas || event.category)?.length ? 3 : 0);
  const evidenceBonus = Math.min(10, Number(event.itemCount || evidence.length || 0));
  return topScore + freshness + explanationBonus + evidenceBonus;
}

function eventSearchText(event) {
  return [
    event.id,
    event.event_id,
    event.title,
    event.summary,
    event.one_sentence_summary,
    ...(Array.isArray(event.category) ? event.category : [event.category]),
    ...(Array.isArray(event.impactAreas) ? event.impactAreas : [event.impactAreas])
  ].filter(Boolean).join(" ").toLowerCase();
}

const HOME_EVENT_THEMES = [
  ["openai", "ai 模型", "ai模型", "模型竞争"],
  ["英伟达", "nvidia", "算力", "ai 算力", "芯片"],
  ["美联储", "fed", "federal reserve", "利率", "宏观利率"]
];

function selectTopEvents(events, limit = 5) {
  const ranked = [...(events || [])]
    .sort((left, right) => eventRankScore(right) - eventRankScore(left)
      || new Date(right.last_updated || right.updatedAt || 0).getTime() - new Date(left.last_updated || left.updatedAt || 0).getTime());
  const selected = [];
  const used = new Set();

  for (const tokens of HOME_EVENT_THEMES) {
    const match = ranked.find((event) => {
      const id = event.event_id || event.id || event.title;
      return !used.has(id) && tokens.some((token) => eventSearchText(event).includes(token));
    });
    if (match) {
      selected.push(match);
      used.add(match.event_id || match.id || match.title);
    }
  }

  for (const event of ranked) {
    if (selected.length >= limit) break;
    const id = event.event_id || event.id || event.title;
    if (!used.has(id)) {
      selected.push(event);
      used.add(id);
    }
  }

  return selected.slice(0, limit);
}

function eventDetailUrl(event) {
  const id = String(event?.event_id || event?.id || "").trim();
  return id ? `event.html?id=${encodeURIComponent(id)}` : "events.html";
}

function eventLatestChange(event) {
  const evidence = event.evidenceItems || event.items || [];
  const latest = event.latestUpdate || evidence[0] || {};
  return event.latest_change || latest.title || event.summary || event.one_sentence_summary || "等待最新信息更新";
}

function renderTopEvents(events) {
  if (!events.length) {
    return `
          <div class="home-event-list" id="home-event-list">
            <div class="empty-state compact-empty">暂无可追踪事件，信息流更新后会自动生成。</div>
          </div>`;
  }

  const renderEventCard = (event, index) => {
    const detailUrl = eventDetailUrl(event);
    const updatedAt = event.last_updated || event.updatedAt;
    return `
              <article class="home-event-card">
                <a class="home-event-card-link" href="${escapeHtml(detailUrl)}" aria-label="查看${escapeHtml(event.title || "重点事件")}追踪详情">
                  <div class="home-event-head">
                    <div>
                      <div class="event-decision-meta">
                        <span>${escapeHtml(event.current_status || "持续追踪")}</span>
                        <span>重要性：${escapeHtml(event.importance_level || event.heat || "中")}</span>
                      </div>
                      <h3>${escapeHtml(event.title || "重点事件")}</h3>
                    </div>
                  </div>
                  <p class="home-event-summary">${escapeHtml(event.one_sentence_summary || event.summary || "暂无事件摘要。")}</p>
                  <div class="home-event-latest">
                    <strong>最新变化</strong>
                    <p>${escapeHtml(eventLatestChange(event))}</p>
                  </div>
                  <dl class="home-event-fields">
                    <div><dt>当前状态</dt><dd>${escapeHtml(event.current_status || "持续追踪")}</dd></div>
                    <div><dt>重要性</dt><dd>${escapeHtml(event.importance_level || event.heat || "中")}</dd></div>
                    <div><dt>置信度</dt><dd>${escapeHtml(event.confidence_level || "中")}</dd></div>
                    <div><dt>更新时间</dt><dd>${escapeHtml(formatDate(updatedAt))}</dd></div>
                  </dl>
                  <span class="event-detail-button home-event-detail-button">查看追踪</span>
                </a>
              </article>`;
  };

  return `
          <div class="home-event-list" id="home-event-list">
            ${events.slice(0, 3).map((event, index) => renderEventCard(event, index)).join("")}
          </div>`;
}

function renderTopHotspots(items, channels = {}) {
  if (!items.length) {
    return `
          <div class="top-hotspots" id="top-hotspot-list">
            <div class="empty-state compact-empty">暂无核心热点，信息流更新后会自动生成。</div>
          </div>`;
  }

  const renderHotspotCard = (item, index) => {
    const topScore = hotspotRankScore(item);
    const heat = topScore >= 65 ? "高" : topScore >= 45 ? "中" : "低";
    const detailUrl = itemDetailUrl(item);
    return `
              <article class="top-hotspot-card top-hotspot-row${index === 0 ? " is-primary" : ""}${index >= 5 ? " is-compact" : ""}">
                <a class="top-hotspot-link" href="${escapeHtml(detailUrl)}">
                  <div class="top-hotspot-rank">#${index + 1}</div>
                  <div class="top-hotspot-body">
                    <h3>${escapeHtml(displayTitle(item))}</h3>
                    <p class="top-hotspot-summary">${escapeHtml(shortExplanation(item))}</p>
                    <p class="top-hotspot-why">${escapeHtml(importanceText(item))}</p>
                    <div class="top-hotspot-meta">
                      <span>来源：${escapeHtml(item.source || "公开来源")}</span>
                      <span>重要度：${heat}</span>
                      <span>Top分：${topScore}</span>
                      <span>更新时间：${escapeHtml(formatDate(item.publishedAt))}</span>
                    </div>
                  </div>
                </a>
              </article>`;
  };

  const primaryItems = items.slice(0, 5);
  const moreItems = items.slice(5);

  return `
          <div class="top-hotspots" id="top-hotspot-list">
            ${primaryItems.map((item, index) => renderHotspotCard(item, index)).join("")}
            ${moreItems.length ? `
            <div class="hotspot-more-list" aria-label="其余热点">
              ${moreItems.map((item, index) => renderHotspotCard(item, index + 5)).join("")}
            </div>` : ""}
          </div>`;
}

function generateStaticSummary() {
  const latest = readJson(path.join(ROOT_DIR, "src", "data", "latest-items.json"), { items: [], generatedAt: "" });
  const eventData = readJson(path.join(ROOT_DIR, "src", "data", "events.json"), { events: [], generatedAt: "" });
  const health = readJson(path.join(ROOT_DIR, "src", "data", "source-health.json"), { sources: [] });
  const healthy = (health.sources || []).filter((source) => source.status === "healthy").length;
  const failed = (health.sources || []).filter((source) => source.status !== "healthy").length;
  const topHotspots = selectTopHotspots(latest.items || [], 5);
  const topEvents = selectTopEvents(eventData.events || [], 3);

  return `${START_MARKER}
          <div class="static-summary-meta">
            信息流更新 ${escapeHtml(formatDate(latest.generatedAt))}；活跃来源 ${healthy} 个，异常来源 ${failed} 个。
          </div>
          <div class="top-hotspots-head">
            <div>
              <h2 id="top-hotspots-title">今日核心热点 Top 5</h2>
              <p>按事件影响、多源确认、市场反馈、后续追踪价值和时效性筛出最值得先看的信息。</p>
            </div>
          </div>
          <div class="home-intel-grid">
            <section class="home-hotspot-panel" aria-labelledby="top-hotspots-title">
              ${renderTopHotspots(topHotspots, latest.channels || {})}
            </section>
          </div>
          <section class="home-event-panel home-event-track-panel" aria-labelledby="home-events-title">
            <div class="top-hotspots-head compact-head">
              <div>
                <h2 id="home-events-title">重点事件追踪</h2>
                <p>读取事件数据，展示当前状态、最新变化和后续追踪入口。</p>
              </div>
              <a class="text-link" href="events.html">查看全部事件</a>
            </div>
            ${renderTopEvents(topEvents)}
          </section>
          ${END_MARKER}`;
}

function updateIndexHtml() {
  const html = fs.readFileSync(INDEX_PATH, "utf8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Static summary markers are missing from index.html");
  }
  const next = `${html.slice(0, start)}${generateStaticSummary()}${html.slice(end + END_MARKER.length)}`;
  fs.writeFileSync(INDEX_PATH, next, "utf8");
  return next;
}

if (require.main === module) {
  updateIndexHtml();
  console.log("Generated static homepage summary.");
}

module.exports = {
  generateStaticSummary,
  selectTopHotspots,
  renderTopHotspots,
  selectTopEvents,
  renderTopEvents,
  eventRankScore,
  hotspotTags,
  hotspotRankScore,
  topScoreBreakdown,
  itemDetailUrl,
  updateIndexHtml
};
