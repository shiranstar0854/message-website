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
  return [...(items || [])]
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0)
      || new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime())
    .slice(0, limit);
}

function channelLabel(channels, category) {
  return channels?.[category]?.label || category || "新闻";
}

function isEnglishSourceItem(item) {
  return item.sourceLanguage === "en" || (/^[\x00-\x7F\s.,:'"!?()-]+$/.test(`${item.title || ""} ${item.summary || ""}`) && /[A-Za-z]/.test(item.title || ""));
}

function displayTitle(item) {
  return item.translatedTitle || item.title || "未命名信息";
}

function shortExplanation(item) {
  return item.aiSummary || item.contentExcerpt || item.summary || "暂无摘要。";
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

function renderTopHotspots(items, channels = {}) {
  if (!items.length) {
    return `
          <div class="top-hotspots" id="top-hotspot-list">
            <div class="empty-state compact-empty">暂无核心热点，信息流更新后会自动生成。</div>
          </div>`;
  }

  return `
          <div class="top-hotspots" id="top-hotspot-list">
            ${items.map((item, index) => `
              <article class="top-hotspot-card${index === 0 ? " is-primary" : ""}">
                <div class="top-hotspot-rank">Top ${index + 1}</div>
                <div class="top-hotspot-body">
                  <h3><a href="${escapeHtml(item.url)}">${escapeHtml(displayTitle(item))}</a></h3>
                  <p>${escapeHtml(shortExplanation(item))}</p>
                  <div class="top-hotspot-importance"><strong>重要性</strong><span>${escapeHtml(importanceText(item))}</span></div>
                  <div class="top-hotspot-impact" aria-label="影响领域">
                    ${impactAreas(item, channels).map((area) => `<span>${escapeHtml(area)}</span>`).join("")}
                  </div>
                  <div class="top-hotspot-meta">
                    <span>${escapeHtml(item.source)}</span>
                    <span>${escapeHtml(channelLabel(channels, item.category))}</span>
                    <span>${escapeHtml(formatDate(item.publishedAt))}</span>
                    <strong>${Number(item.score || 0)}</strong>
                    ${isEnglishSourceItem(item) ? `<a href="${escapeHtml(item.url)}">原文入口</a>` : ""}
                  </div>
                </div>
              </article>`).join("")}
          </div>`;
}

function generateStaticSummary() {
  const latest = readJson(path.join(ROOT_DIR, "src", "data", "latest-items.json"), { items: [], generatedAt: "" });
  const health = readJson(path.join(ROOT_DIR, "src", "data", "source-health.json"), { sources: [] });
  const healthy = (health.sources || []).filter((source) => source.status === "healthy").length;
  const failed = (health.sources || []).filter((source) => source.status !== "healthy").length;
  const topHotspots = selectTopHotspots(latest.items || [], 5);

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
          ${renderTopHotspots(topHotspots, latest.channels || {})}
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
  updateIndexHtml
};
