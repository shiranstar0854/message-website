const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSourceHealth, buildEffectiveResults } = require("../scripts/fetch-rss");
const { buildSourceAudit } = require("../scripts/source-audit");
const { compactItem, selectArchiveItems } = require("../scripts/archive-daily-data");

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
        lastSuccessAt: "2026-05-25T02:00:00.000Z"
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
  assert.equal(audit.sources[0].enrichmentAttempted, 1);
  assert.equal(audit.sources[0].enrichmentExcerptCount, 1);
});

test("daily archive compacts article payloads", () => {
  const archived = compactItem({
    id: "item-a",
    title: "Title",
    url: "https://example.test/item",
    source: "Source A",
    sourceType: "rss",
    category: "tech",
    publishedAt: "2026-05-26T01:00:00.000Z",
    summary: "x".repeat(800),
    contentExcerpt: "y".repeat(900),
    imageUrl: "https://example.test/image.jpg",
    score: 95,
    duplicateCount: 0,
    tags: Array.from({ length: 12 }, (_, index) => `tag-${index}`),
    raw: { large: "ignored" }
  });

  assert.equal(archived.summary.length, 500);
  assert.equal(archived.contentExcerpt.length, 500);
  assert.equal(archived.imageUrl, "https://example.test/image.jpg");
  assert.equal(archived.tags.length, 8);
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
