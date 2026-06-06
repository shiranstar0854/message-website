const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

function loadFilters() {
  const context = { window: {} };
  vm.createContext(context);
  const script = fs.readFileSync(path.join(__dirname, "..", "src", "scripts", "filters-ui.js"), "utf8");
  vm.runInContext(script, context);
  return context.window.MessageChooseFilters;
}

test("keyword search matches aiSummary and keywords with AND terms", () => {
  const filters = loadFilters();
  const items = [{
    id: "match",
    title: "OpenAI product update",
    source: "OpenAI News",
    category: "tech",
    score: 90,
    aiSummary: "中文摘要：企业生产力工具更新。",
    keywords: ["Codex", "生产力"]
  }, {
    id: "miss",
    title: "Market report",
    source: "Market Desk",
    category: "finance",
    score: 100,
    summary: "Liquidity update.",
    keywords: ["market"]
  }];

  const result = filters.applyFilters(items, {
    channel: "all",
    source: "all",
    keyword: "codex 生产力",
    minScore: 0,
    sort: "score-desc"
  });

  assert.deepEqual(Array.from(result, (item) => item.id), ["match"]);
});

test("keyword search sorts by relevance before score and time", () => {
  const filters = loadFilters();
  const items = [{
    id: "score-only",
    title: "AI update",
    source: "Example",
    category: "tech",
    score: 100,
    publishedAt: "2026-06-03T00:00:00.000Z",
    summary: "AI policy appears in the body."
  }, {
    id: "title-and-keyword",
    title: "AI infrastructure policy",
    source: "Example",
    category: "tech",
    score: 80,
    publishedAt: "2026-06-01T00:00:00.000Z",
    keywords: ["AI", "policy"]
  }];

  const result = filters.applyFilters(items, {
    channel: "all",
    source: "all",
    keyword: "AI policy",
    minScore: 0,
    sort: "score-desc"
  });

  assert.deepEqual(Array.from(result, (item) => item.id), ["title-and-keyword", "score-only"]);
});

test("keyword search expands Chinese and English aliases", () => {
  const filters = loadFilters();
  const items = [{
    id: "macro",
    title: "Federal Reserve rate decision",
    source: "Federal Reserve",
    category: "macro",
    score: 90,
    summary: "Policy makers discuss inflation."
  }, {
    id: "tech",
    title: "Developer platform update",
    source: "Tech Source",
    category: "tech",
    score: 95,
    summary: "General product update."
  }];

  const result = filters.applyFilters(items, {
    channel: "all",
    source: "all",
    keyword: "宏观",
    minScore: 0,
    sort: "score-desc"
  });

  assert.deepEqual(Array.from(result, (item) => item.id), ["macro"]);
});

test("keyword search exposes hit labels for rendered feedback", () => {
  const filters = loadFilters();
  const labels = filters.getSearchHitLabels({
    title: "AI infrastructure policy",
    source: "OpenAI News",
    summary: "Policy update for compute governance.",
    keywords: ["AI", "policy"],
    score: 90,
    publishedAt: new Date().toISOString()
  }, ["AI", "policy"]);

  assert.ok(labels.includes("标题命中"));
  assert.ok(labels.includes("关键词命中"));
});
