const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildDailyEventsFromItems, generateDailyEvents } = require("../scripts/generate-daily-events");

const ROOT_DIR = path.resolve(__dirname, "..");

test("internal daily event aggregation keeps facts, sources and watch variables", () => {
  const output = buildDailyEventsFromItems([{
    id: "one",
    eventClusterKey: "policy-change-agency",
    title: "Agency publishes policy change",
    title_zh: "机构发布政策变化",
    url: "https://example.test/one",
    source: "Agency",
    category: "policy",
    eventType: "policy_change",
    score: 92,
    confirmed_facts: [{ text: "机构已经公布政策文件。" }],
    classification: { factors: { subject: "机构" } },
    article_brief: {
      current_progress: { stage: "announced", details: "已经正式公布，尚待执行。" },
      key_data: [],
      watch_variables: [{ variable: "正式执行文件" }],
      impact: { direct: "可能改变相关主体的执行安排。" }
    }
  }, {
    id: "two",
    eventClusterKey: "policy-change-agency",
    title: "Agency explains policy change",
    url: "https://example.test/two",
    source: "Independent Source",
    category: "policy",
    eventType: "policy_change",
    score: 88,
    confirmed_facts: [{ text: "独立来源确认文件已经公布。" }]
  }], "2026-07-13T00:00:00.000Z");
  assert.equal(output.schema_version, "daily-events.v3");
  assert.equal(output.events.length, 1);
  assert.equal(output.events[0].source_count, 2);
  assert.equal(output.events[0].confirmed_facts.length, 2);
  assert.equal(output.events[0].current_progress.stage, "announced");
  assert.equal(output.events[0].watch_variables[0].variable, "正式执行文件");
});

test("public event pages, scripts, data and commands are absent", () => {
  [
    "events.html",
    "event.html",
    "src/scripts/events.js",
    "src/scripts/event-detail.js",
    "src/data/events.json",
    "scripts/generate-events.js",
    "scripts/generate-event-analysis.js"
  ].forEach((file) => assert.equal(fs.existsSync(path.join(ROOT_DIR, file)), false, file));
  const packageJson = fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8");
  assert.match(packageJson, /generate:brief-events/);
  assert.doesNotMatch(packageJson, /generate:events|analyze:events|generate-events\.js/);
});

test("internal event generation preserves the previous file when upstream input is missing", () => {
  const previous = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "data", "processed", "daily-events.json"), "utf8"));
  const output = generateDailyEvents();
  assert.deepEqual(output, previous);
});
