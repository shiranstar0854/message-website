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

function renderChannelSummary(channel) {
  return `
              <article class="focus-card">
                <strong>${escapeHtml(channel.label || channel.id)}</strong>
                <p>${escapeHtml(channel.overview || "暂无摘要，信息流更新后会显示本频道重点。")}</p>
              </article>`;
}

function generateStaticSummary() {
  const latest = readJson(path.join(ROOT_DIR, "src", "data", "latest-items.json"), { items: [], generatedAt: "" });
  const daily = readJson(path.join(ROOT_DIR, "src", "data", "daily-summary.json"), { channelSummaries: [] });
  const health = readJson(path.join(ROOT_DIR, "src", "data", "source-health.json"), { sources: [] });
  const healthy = (health.sources || []).filter((source) => source.status === "healthy").length;
  const failed = (health.sources || []).filter((source) => source.status !== "healthy").length;
  const focus = (daily.channelSummaries || []).slice(0, 3);
  const topItems = (latest.topHotspots || latest.items || []).slice(0, 6);

  return `${START_MARKER}
          <div class="static-summary-meta">
            信息流更新 ${escapeHtml(formatDate(latest.generatedAt))}；活跃来源 ${healthy} 个，异常来源 ${failed} 个。
          </div>
          <div class="focus-grid" id="daily-focus-grid">
            ${focus.length ? focus.map(renderChannelSummary).join("") : `
              <article class="focus-card"><strong>科技</strong><p>暂无摘要，信息流更新后会显示本频道重点。</p></article>
              <article class="focus-card"><strong>金融</strong><p>暂无摘要，信息流更新后会显示本频道重点。</p></article>
              <article class="focus-card"><strong>新闻</strong><p>暂无摘要，信息流更新后会显示本频道重点。</p></article>`}
          </div>
          <div class="static-top-items">
            <h3>最新高分条目</h3>
            <ul>
              ${topItems.map((item) => `
                <li><a href="${escapeHtml(item.url)}">${escapeHtml(item.displayTitle || item.title)}</a><span>${escapeHtml(item.source)} · ${Number(item.score || item.importance || 0)}</span></li>`).join("")}
            </ul>
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
  updateIndexHtml
};
