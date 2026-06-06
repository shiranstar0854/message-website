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
  return item.sourceLanguage === "en" || (/^[\x00-\x7F\s.,:'"!?()-]+$/.test(`${item.title || ""} ${item.summary || ""}`) && /[A-Za-z]/.test(item.title || ""));
}

function displayTitle(item) {
  return item.titleZh || item.translatedTitle || item.title || "未命名信息";
}

function shortExplanation(item) {
  return item.summaryZh || item.aiSummary || item.contentExcerpt || item.summary || "暂无摘要。";
}

function importanceText(item) {
  return item.importance || item.summaryReason || `评分 ${Number(item.score || 0)}，来自${item.source || "公开来源"}。`;
}

function impactAreas(item, channels = {}) {
  const areas = item.impactAreas?.length
    ? item.impactAreas
    : (item.keywords || item.tags || []).slice(0, 4);
  return areas.length ? areas : [channelLabel(channels, item.category)];
}

function hotspotTags(item, channels = {}) {
  return impactAreas(item, channels).slice(0, 2);
}

function hotspotEventKey(item) {
  const keywords = (item.impactAreas || item.keywords || item.tags || []).slice(0, 2).join("|").toLowerCase();
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
          <div class="top-hotspots" id="top-hotspot-list">
            <div class="empty-state compact-empty">暂无今日最该看事件，信息流更新后会自动生成。</div>
          </div>`;
  }

  const renderEventCard = (event, index) => {
    const evidence = event.evidenceItems || event.items || [];
    const primaryUrl = evidence[0]?.url || "";
    const body = `
                  <div class="top-hotspot-rank">${index === 0 ? "最该看" : `Top ${index + 1}`}</div>
                  <div class="top-hotspot-body">
                    <h3>${escapeHtml(event.title || "重点事件")}</h3>
                    <p class="top-hotspot-summary"><span>发生了什么</span>${escapeHtml(event.summary || "暂无事件摘要。")}</p>
                    <p class="top-hotspot-why"><span>为什么重要</span>${escapeHtml(event.whyItMatters || "该事件可能影响政策、市场或产业判断。")}</p>
                    <div class="top-hotspot-impact" aria-label="影响范围">
                      ${(event.impactAreas || event.keywords || []).slice(0, 3).map((area) => `<span>${escapeHtml(area)}</span>`).join("")}
                    </div>
                    ${index === 0 && event.watchlist?.length ? `
                      <ul class="top-hotspot-watchlist">
                        ${event.watchlist.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                      </ul>
                    ` : ""}
                    <div class="top-hotspot-meta">
                      <span>证据 ${Number(event.itemCount || evidence.length || 0)} 条</span>
                      <span>更新 ${escapeHtml(formatDate(event.updatedAt))}</span>
                      ${evidence[0]?.source ? `<span>来源 ${escapeHtml(evidence[0].source)}</span>` : ""}
                      <strong>${Number(evidence[0]?.score || 0)}</strong>
                    </div>
                  </div>`;
    return `
              <article class="top-hotspot-card${index === 0 ? " is-primary top-hotspot-main" : ""}">
                ${primaryUrl
                  ? `<a class="top-hotspot-link" href="${escapeHtml(primaryUrl)}">${body}</a>`
                  : `<div class="top-hotspot-link">${body}</div>`}
              </article>`;
  };
  const [primary, ...secondary] = events;

  return `
          <div class="top-hotspots" id="top-hotspot-list">
            ${renderEventCard(primary, 0)}
            <div class="top-hotspot-secondary">
              ${secondary.map((event, index) => renderEventCard(event, index + 1)).join("")}
            </div>
          </div>`;
}

function renderTopHotspots(items, channels = {}) {
  if (!items.length) {
    return `
          <div class="top-hotspots" id="top-hotspot-list">
            <div class="empty-state compact-empty">暂无核心热点，信息流更新后会自动生成。</div>
          </div>`;
  }

  const renderHotspotCard = (item, index) => `
              <article class="top-hotspot-card${index === 0 ? " is-primary" : ""}">
                <a class="top-hotspot-link" href="${escapeHtml(item.url)}">
                  <div class="top-hotspot-rank">Top ${index + 1}</div>
                  <div class="top-hotspot-body">
                    <h3>${escapeHtml(displayTitle(item))}</h3>
                    <p class="top-hotspot-summary"><span>摘要</span>${escapeHtml(shortExplanation(item))}</p>
                    ${index === 0 ? `
                      <p class="top-hotspot-why"><span>为什么重要</span>${escapeHtml(importanceText(item))}</p>
                    ` : ""}
                    <div class="top-hotspot-impact" aria-label="影响领域">
                      ${hotspotTags(item, channels).map((area) => `<span>${escapeHtml(area)}</span>`).join("")}
                    </div>
                    <div class="top-hotspot-meta">
                      <span>${escapeHtml(channelLabel(channels, item.category))}</span>
                      <span>来源 ${escapeHtml(item.source || "公开来源")}</span>
                      <span>更新 ${escapeHtml(formatDate(item.publishedAt))}</span>
                      <strong>${Number(item.score || 0)}</strong>
                    </div>
                  </div>
                </a>
              </article>`;
  const [primary, ...secondary] = items;

  return `
          <div class="top-hotspots" id="top-hotspot-list">
            ${renderHotspotCard(primary, 0)}
            <div class="top-hotspot-secondary">
              ${secondary.map((item, index) => renderHotspotCard(item, index + 1)).join("")}
            </div>
          </div>`;
}

function generateStaticSummary() {
  const latest = readJson(path.join(ROOT_DIR, "src", "data", "latest-items.json"), { items: [], generatedAt: "" });
  const eventData = readJson(path.join(ROOT_DIR, "src", "data", "events.json"), { events: [], generatedAt: "" });
  const health = readJson(path.join(ROOT_DIR, "src", "data", "source-health.json"), { sources: [] });
  const healthy = (health.sources || []).filter((source) => source.status === "healthy").length;
  const failed = (health.sources || []).filter((source) => source.status !== "healthy").length;
  const topHotspots = selectTopHotspots(latest.items || [], 5);
  const topEvents = selectTopEvents(eventData.events || [], 5);

  return `${START_MARKER}
          <div class="static-summary-meta">
            信息流更新 ${escapeHtml(formatDate(latest.generatedAt))}；活跃来源 ${healthy} 个，异常来源 ${failed} 个。
          </div>
          <div class="top-hotspots-head">
            <div>
              <h2 id="top-hotspots-title">今日核心热点 Top 5</h2>
              <p>按评分和发布时间筛出最值得先看的信息。</p>
            </div>
          </div>
          ${topEvents.length ? renderTopEvents(topEvents) : renderTopHotspots(topHotspots, latest.channels || {})}
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
  updateIndexHtml
};
