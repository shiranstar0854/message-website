const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildSourceHealth, buildEffectiveResults } = require("../scripts/fetch-rss");
const { buildSourceAudit, buildPerformanceRun } = require("../scripts/source-audit");
const { compactItem, selectArchiveItems, buildHistoryIndex } = require("../scripts/archive-daily-data");

const PRIOR_XML = "<rss><channel><item><title>Existing item</title><link>https://example.test/existing</link></item></channel></rss>";

test("retains previous usable RSS items when the latest source request fails", () => {
  const failedResult = {
    sourceId: "source-a",
    sourceName: "Source A",
    category: "news",
    credibility: 80,
    url: "https://feed.test/rss",
    ok: false,
    fetchedAt: "2026-05-26T02:00:00.000Z",
    cacheTtlHours: 24,
    cacheStartedAt: "2026-05-26T02:00:00.000Z",
    cacheExpiresAt: "2026-05-27T02:00:00.000Z",
    error: "timeout"
  };
  const previous = [{
    sourceId: "source-a",
    sourceName: "Source A",
    category: "news",
    credibility: 80,
    url: "https://feed.test/rss",
    ok: true,
    itemCount: 1,
    fetchedAt: "2026-05-25T02:00:00.000Z",
    body: PRIOR_XML
  }];

  const effective = buildEffectiveResults([failedResult], previous);
  const health = buildSourceHealth([failedResult], {
    sources: [{ id: "source-a", failureCount: 2, lastSuccessAt: "2026-05-25T02:00:00.000Z" }]
  }, "2026-05-26T02:00:01.000Z");

  assert.equal(effective[0].stale, true);
  assert.equal("body" in effective[0], false);
  assert.equal(effective[0].items.length, 1);
  assert.equal(effective[0].items[0].title, "Existing item");
  assert.equal(effective[0].latestAttempt.error, "timeout");
  assert.equal(health.sources[0].status, "failed");
  assert.equal(health.sources[0].failureCount, 3);
  assert.equal(health.sources[0].error, "timeout");
  assert.equal(health.sources[0].lastSuccessAt, "2026-05-25T02:00:00.000Z");
  assert.equal(health.sources[0].cacheTtlHours, 24);
  assert.equal(health.sources[0].cacheExpiresAt, "2026-05-27T02:00:00.000Z");
});

test("does not reuse RSS fallback when latest request succeeds with no fresh items", () => {
  const emptyResult = {
    sourceId: "source-a",
    sourceName: "Source A",
    category: "news",
    credibility: 80,
    url: "https://feed.test/rss",
    ok: true,
    itemCount: 0,
    fetchedAt: "2026-05-26T02:00:00.000Z",
    items: []
  };
  const previous = [{
    sourceId: "source-a",
    sourceName: "Source A",
    ok: true,
    itemCount: 1,
    fetchedAt: "2026-05-25T02:00:00.000Z",
    body: PRIOR_XML
  }];

  const effective = buildEffectiveResults([emptyResult], previous);
  const health = buildSourceHealth([emptyResult], {
    sources: [{ id: "source-a", failureCount: 2, lastSuccessAt: "2026-05-25T02:00:00.000Z" }]
  }, "2026-05-26T02:00:01.000Z");

  assert.equal(effective[0].stale, false);
  assert.equal(effective[0].itemCount, 0);
  assert.deepEqual(effective[0].items, []);
  assert.equal(health.sources[0].status, "empty");
  assert.equal(health.sources[0].failureCount, 0);
  assert.equal(health.sources[0].lastSuccessAt, "2026-05-25T02:00:00.000Z");
});

test("builds source audit metrics and marks fallback data", () => {
  const audit = buildSourceAudit({
    health: {
      sources: [{
        id: "source-a",
        name: "Source A",
        category: "news",
        status: "failed",
        failureCount: 1,
        lastCheckedAt: "2026-05-26T02:00:00.000Z",
        lastSuccessAt: "2026-05-25T02:00:00.000Z",
        cacheTtlHours: 48,
        cacheStartedAt: "2026-05-26T02:00:00.000Z",
        cacheExpiresAt: "2026-05-28T02:00:00.000Z"
      }]
    },
    rawRecords: [{ sourceId: "source-a", itemCount: 2, stale: true }],
    normalized: [
      { source: "Source A", publishedAt: "2026-05-25T01:00:00.000Z" },
      { source: "Source A", publishedAt: "2026-05-25T02:00:00.000Z" }
    ],
    filtered: [{ source: "Source A" }],
    deduped: [{ source: "Source A" }],
    scored: [{ source: "Source A" }],
    enrichment: {
      totals: { attempted: 1, failed: 0 },
      sources: {
        "source-a": { attempted: 1, excerptCount: 1, imageCount: 0, failed: 0 }
      }
    }
  }, "2026-05-26T02:00:01.000Z");

  assert.equal(audit.totals.rawItems, 2);
  assert.equal(audit.sources[0].usedFallback, true);
  assert.equal(audit.sources[0].filteredOutItems, 1);
  assert.equal(audit.sources[0].newestPublishedAt, "2026-05-25T02:00:00.000Z");
  assert.equal(audit.sources[0].cacheTtlHours, 48);
  assert.equal(audit.sources[0].cacheExpiresAt, "2026-05-28T02:00:00.000Z");
  assert.equal(audit.sources[0].enrichmentAttempted, 1);
  assert.equal(audit.sources[0].enrichmentExcerptCount, 1);
});

test("performance history records the actual attempt instead of cached fallback volume", () => {
  const run = buildPerformanceRun({
    fetchedCount: 12,
    retainedItems: 8,
    deduplicatedItems: 4,
    highValueRate: 0.75,
    enrichmentAttempted: 3,
    bodySuccessRate: 1,
    averageInformationDensity: 70,
    reviewedItems: 3
  }, {
    ok: false,
    itemCount: 0,
    isProbe: true
  }, "2026-07-12T00:00:00.000Z");

  assert.equal(run.fetchedCount, 0);
  assert.equal(run.passedCount, 0);
  assert.equal(run.highValueCount, 0);
  assert.equal(run.bodyAttemptCount, 0);
  assert.equal(run.bodySuccessRate, null);
  assert.equal(run.fetchFailed, true);
  assert.equal(run.isProbe, true);
});

test("daily archive compacts article payloads", () => {
  const archived = compactItem({
    id: "item-a",
    title: "Title",
    translatedTitle: "中文标题",
    url: "https://example.test/item",
    source: "Source A",
    sourceType: "rss",
    category: "tech",
    publishedAt: "2026-05-26T01:00:00.000Z",
    summary: "x".repeat(800),
    contentExcerpt: "y".repeat(900),
    aiSummary: "a".repeat(300),
    summaryReason: "r".repeat(300),
    importance: "重要性说明",
    sourceLanguage: "en",
    summaryLanguage: "zh",
    imageUrl: "https://example.test/image.jpg",
    score: 95,
    duplicateCount: 0,
    tags: Array.from({ length: 12 }, (_, index) => `tag-${index}`),
    keywords: Array.from({ length: 12 }, (_, index) => `keyword-${index}`),
    impactAreas: ["AI政策", "地缘政治", "消费电子", "财报", "额外标签"],
    raw: { large: "ignored" }
  });

  assert.equal(archived.translatedTitle, "中文标题");
  assert.equal(archived.summary.length, 500);
  assert.equal(archived.contentExcerpt.length, 500);
  assert.equal(archived.aiSummary.length, 240);
  assert.equal(archived.summaryReason.length, 160);
  assert.equal(archived.importance, "重要性说明");
  assert.equal(archived.sourceLanguage, "en");
  assert.equal(archived.summaryLanguage, "zh");
  assert.equal(archived.imageUrl, "https://example.test/image.jpg");
  assert.equal(archived.tags.length, 8);
  assert.equal(archived.keywords.length, 8);
  assert.deepEqual(archived.impactAreas, ["AI政策", "地缘政治", "消费电子", "财报"]);
  assert.equal("raw" in archived, false);
});

test("daily archive retains at most twenty ranked items per channel", () => {
  const items = [
    ...Array.from({ length: 24 }, (_, index) => ({ id: `tech-${index}`, category: "tech" })),
    ...Array.from({ length: 22 }, (_, index) => ({ id: `news-${index}`, category: "news" }))
  ];
  const selected = selectArchiveItems(items);

  assert.equal(selected.filter((item) => item.category === "tech").length, 20);
  assert.equal(selected.filter((item) => item.category === "news").length, 20);
  assert.equal(selected.find((item) => item.id === "tech-0").id, "tech-0");
});

test("history index exposes latest days without deleting older archive files", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "message-archive-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const archiveDir = path.join(tempRoot, "daily");
  const indexPath = path.join(tempRoot, "history-index.json");
  fs.mkdirSync(archiveDir, { recursive: true });

  for (let day = 1; day <= 12; day += 1) {
    const date = `2026-05-${String(day).padStart(2, "0")}`;
    fs.writeFileSync(path.join(archiveDir, `${date}.json`), JSON.stringify({
      date,
      generatedAt: `${date}T00:00:00.000Z`,
      items: [{ id: date }],
      totals: { scoredItems: 1 }
    }));
  }

  const index = buildHistoryIndex(10, {
    archiveDir,
    historyIndexPath: indexPath,
    now: "2026-06-04T00:00:00.000Z"
  });
  const remainingFiles = fs.readdirSync(archiveDir).filter((file) => file.endsWith(".json"));

  assert.equal(index.totalArchiveDays, 12);
  assert.equal(index.totalDays, 10);
  assert.deepEqual(index.days.map((day) => day.date), [
    "2026-05-12",
    "2026-05-11",
    "2026-05-10",
    "2026-05-09",
    "2026-05-08",
    "2026-05-07",
    "2026-05-06",
    "2026-05-05",
    "2026-05-04",
    "2026-05-03"
  ]);
  assert.equal(remainingFiles.length, 12);
  assert.equal(fs.existsSync(path.join(archiveDir, "2026-05-01.json")), true);
  assert.equal(index.days[0].eventCount, 0);
  assert.equal(index.days[0].hasBrief, false);
  assert.equal(index.days[0].briefUrl, null);
});
