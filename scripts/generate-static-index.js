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
    .sort((left, right) => hotspotRankScore(right) - hotspotRankScore(left)
      || Number(right.score || 0) - Number(left.score || 0)
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
  const text = item.summary_zh || item.summaryZh || item.aiSummary || item.contentExcerpt || item.summary || item.summary_original || "暂无摘要。";
  return text.length > 86 ? `${text.slice(0, 83).trimEnd()}...` : text;
}

function importanceText(item) {
  return item.importance || item.summaryReason || `评分 ${Number(item.score || 0)}，来自${item.source || "公开来源"}。`;
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

function hotspotRankScore(item) {
  const publishedTime = new Date(item.publishedAt || 0).getTime();
  const freshness = Number.isNaN(publishedTime) ? 0 : Math.max(0, 12 - (Date.now() - publishedTime) / (6 * 60 * 60 * 1000));
  const readableBonus = (item.aiSummary || item.summaryZh || item.contentExcerpt ? 8 : 0) + (item.importance || item.summaryReason ? 5 : 0);
  const sourceBonus = ["official-agency", "official-market", "official-media"].includes(item.sourceAuthority) ? 4 : 0;
  return Number(item.score || 0) + freshness + readableBonus + sourceBonus;
}

function eventRankScore(event) {
  const updatedTime = new Date(event.updatedAt || 0).getTime();
  const freshness = Number.isNaN(updatedTime) ? 0 : Math.max(0, 16 - (Date.now() - updatedTime) / (6 * 60 * 60 * 1000));
  const evidence = event.evidenceItems || event.items || [];
  const topScore = Number(evidence[0]?.score || 0);
  const explanationBonus = (event.whyItMatters ? 8 : 0) + (event.watchlist?.length ? 5 : 0) + (event.impactAreas?.length ? 3 : 0);
  const evidenceBonus = Math.min(10, Number(event.itemCount || evidence.length || 0));
  return topScore + freshness + explanationBonus + evidenceBonus;
}

function selectTopEvents(events, limit = 5) {
  return [...(events || [])]
    .sort((left, right) => eventRankScore(right) - eventRankScore(left)
      || new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime())
    .slice(0, limit);
}

function renderTopEvents(events) {
  if (!events.length) {
    return `
          <div class="home-event-list" id="home-event-list">
            <div class="empty-state compact-empty">暂无可追踪事件，信息流更新后会自动生成。</div>
          </div>`;
  }

  const renderEventCard = (event, index) => {
    const evidence = event.evidenceItems || event.items || [];
    const latest = event.latestUpdate || evidence[0] || {};
    const latestUrl = latest.url ? escapeHtml(itemDetailUrl(latest)) : "";
    const latestTitle = latestUrl
      ? `<a href="${latestUrl}">${escapeHtml(latest.title || "")}</a>`
      : escapeHtml(latest.title || "");
    return `
              <article class="home-event-card">
                <div class="home-event-head">
                  <h3>${escapeHtml(event.title || "重点事件")}</h3>
                  <span>热度：${escapeHtml(event.heat || "中")}</span>
                </div>
                <p>${escapeHtml(event.summary || "暂无事件摘要。")}</p>
                <div class="home-event-latest">
                  <strong>最新进展</strong>
                  <p>${latestTitle}</p>
                  <span>来源：${escapeHtml(latest.source || event.primarySource || "公开来源")} · 时间：${escapeHtml(formatDate(latest.publishedAt || event.updatedAt))}</span>
                </div>
                <ol class="home-event-timeline">
                  ${(event.keyDevelopments || event.timeline || evidence).slice(-4).map((item) => {
                    const itemTitle = item.url
                      ? `<a href="${escapeHtml(itemDetailUrl(item))}">${escapeHtml(item.title || "")}</a>`
                      : escapeHtml(item.title || "");
                    return `
                    <li>
                      <time>${escapeHtml(formatDate(item.publishedAt || item.date))}</time>
                      <span>${itemTitle}<small>${escapeHtml(item.source || "")}</small></span>
                    </li>
                  `;
                  }).join("")}
                </ol>
                <a class="text-link" href="events.html">查看事件追踪</a>
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
    const heat = Number(item.score || 0) >= 90 ? "高" : Number(item.score || 0) >= 75 ? "中" : "低";
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
                      <span>热度：${heat}</span>
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
  const topHotspots = selectTopHotspots(latest.items || [], 12);
  const topEvents = selectTopEvents(eventData.events || [], 5);

  return `${START_MARKER}
          <div class="static-summary-meta">
            信息流更新 ${escapeHtml(formatDate(latest.generatedAt))}；活跃来源 ${healthy} 个，异常来源 ${failed} 个。
          </div>
          <div class="top-hotspots-head">
            <div>
              <h2 id="top-hotspots-title">今日核心热点 Top 5</h2>
              <p>按评分、时效和来源权重筛出最值得先看的信息。</p>
            </div>
          </div>
          <div class="home-intel-grid">
            <section class="home-hotspot-panel" aria-labelledby="top-hotspots-title">
              ${renderTopHotspots(topHotspots, latest.channels || {})}
            </section>
            <aside class="home-event-panel" aria-labelledby="home-events-title">
              <div class="top-hotspots-head compact-head">
                <div>
                  <h2 id="home-events-title">事件追踪</h2>
                  <p>近 90 天连续报道时间线。</p>
                </div>
              </div>
              ${renderTopEvents(topEvents)}
            </aside>
          </div>
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
  itemDetailUrl,
  updateIndexHtml
};
