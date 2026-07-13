const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractArticleData,
  selectEnrichmentCandidates,
  enrichItems
} = require("../scripts/enrich-articles");

test("extracts article paragraph text before metadata and keeps https image urls", () => {
  const extracted = extractArticleData(`
    <html>
      <head>
        <meta property="og:description" content="Metadata fallback description">
        <meta property="og:image" content="https://example.test/hero.jpg">
      </head>
      <body>
        <article>
          <p>This is a long enough paragraph from the article body that should be preferred over metadata.</p>
        </article>
      </body>
    </html>
  `, {
    url: "https://example.test/story",
    summary: "Feed summary"
  });

  assert.match(extracted.contentExcerpt, /article body/);
  assert.equal(extracted.excerptSource, "article");
  assert.equal(extracted.imageUrl, "https://example.test/hero.jpg");
});

test("falls back to feed excerpt and rejects non-https page images", () => {
  const extracted = extractArticleData(`
    <html>
      <head>
        <meta property="og:image" content="http://example.test/hero.jpg">
      </head>
      <body><main>No useful paragraphs.</main></body>
    </html>
  `, {
    url: "https://example.test/story",
    contentExcerpt: "Feed-provided excerpt",
    imageUrl: "https://example.test/feed.jpg"
  });

  assert.equal(extracted.contentExcerpt, "Feed-provided excerpt");
  assert.equal(extracted.imageUrl, "https://example.test/feed.jpg");
  assert.equal(extracted.excerptSource, "feed");
});

test("ignores date-only article text and falls back to feed excerpt", () => {
  const extracted = extractArticleData(`
    <html>
      <body>
        <article>
          <p>,2026-04-14</p>
          <p>2026-05-16</p>
        </article>
      </body>
    </html>
  `, {
    url: "https://example.test/story",
    summary: "Official feed summary should remain visible"
  });

  assert.equal(extracted.contentExcerpt, "Official feed summary should remain visible");
  assert.equal(extracted.excerptSource, "feed");
});

test("removes trailing article date noise from extracted text", () => {
  const extracted = extractArticleData(`
    <html><body><article>
      <p>This official release contains enough useful context for display,2026-05-22</p>
    </article></body></html>
  `, {
    url: "https://example.test/story",
    summary: "Feed summary"
  });

  assert.equal(extracted.contentExcerpt, "This official release contains enough useful context for display");
  assert.equal(extracted.excerptSource, "article");
});

test("enriches the preselected candidate pool and skips disabled sources", () => {
  const sources = [
    { id: "enabled", name: "Enabled", articleEnrichment: { enabled: true } },
    { id: "disabled", name: "Disabled", articleEnrichment: { enabled: false } }
  ];
  const items = [
    ...Array.from({ length: 24 }, (_, index) => ({
      id: `tech-${index}`,
      title: `Tech ${index}`,
      url: `https://example.test/tech-${index}`,
      sourceId: "enabled",
      source: "Enabled",
      category: "tech",
      score: 100 - index,
      publishedAt: "2026-05-24T00:00:00.000Z"
    })),
    {
      id: "disabled-news",
      title: "Disabled source",
      url: "https://example.test/disabled",
      sourceId: "disabled",
      source: "Disabled",
      category: "news",
      score: 100,
      publishedAt: "2026-05-24T00:00:00.000Z"
    }
  ];

  const selected = selectEnrichmentCandidates(items, sources, 20);

  assert.equal(selected.filter((item) => item.category === "tech").length, 24);
  assert.equal(selected.some((item) => item.id === "disabled-news"), false);
});

test("keeps daily generation alive when a single article request fails", async () => {
  const items = [
    {
      id: "ok",
      title: "Ok",
      url: "https://example.test/ok",
      sourceId: "enabled",
      source: "Enabled",
      category: "tech",
      score: 100,
      publishedAt: "2026-05-24T00:00:00.000Z",
      summary: "Feed summary"
    },
    {
      id: "fail",
      title: "Fail",
      url: "https://example.test/fail",
      sourceId: "enabled",
      source: "Enabled",
      category: "tech",
      score: 99,
      publishedAt: "2026-05-24T00:00:00.000Z",
      summary: "Feed summary"
    }
  ];
  const sources = [{ id: "enabled", name: "Enabled", articleEnrichment: { enabled: true } }];
  const result = await enrichItems(items, sources, {
    fetchArticle: async (url) => {
      if (url.endsWith("/fail")) throw new Error("blocked");
      return "<article><p>This paragraph is long enough to become an extracted article excerpt for display.</p></article>";
    },
    concurrency: 1
  });

  assert.equal(result.items.length, 2);
  assert.match(result.items.find((item) => item.id === "ok").contentExcerpt, /extracted article/);
  assert.equal(result.items.find((item) => item.id === "fail").summary, "Feed summary");
  assert.equal(result.stats.totals.attempted, 2);
  assert.equal(result.stats.totals.failed, 1);
});

test("extracts common Chinese official-page content containers", () => {
  const extracted = extractArticleData(`
    <html><body><div id="UCAP-CONTENT">
      <p>国务院有关部门发布实施安排，并要求相关单位在规定时间内完成公开可验证的工作。</p>
      <p>文件同时列明后续检查条件和执行范围，为判断政策进展提供正式依据。</p>
    </div></body></html>
  `, { url: "https://www.gov.cn/example" });

  assert.match(extracted.bodyText, /后续检查条件/);
  assert.equal(extracted.excerptSource, "article");
});

test("marks body-disabled sources without counting a failed request", async () => {
  const result = await enrichItems([{
    id: "disabled",
    title: "Metadata-only official release",
    url: "https://example.test/disabled",
    sourceId: "disabled-source",
    source: "Disabled Source"
  }], [{
    id: "disabled-source",
    name: "Disabled Source",
    articleEnrichment: { enabled: false }
  }], {
    fetchArticle: async () => { throw new Error("must not be called"); }
  });

  assert.equal(result.items[0].bodyFetchStatus, "disabled");
  assert.equal(result.stats.totals.attempted, 0);
  assert.equal(result.stats.totals.failed, 0);
});
