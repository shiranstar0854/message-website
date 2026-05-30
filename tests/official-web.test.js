const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractHtmlItems,
  mapJsonItems,
  buildSourceHealth,
  buildEffectiveResults,
  mergeSourceHealth
} = require("../scripts/fetch-official-web");

test("maps official json list items into normalized webpage records", () => {
  const items = mapJsonItems({
    url: "https://www.gov.cn/yaowen/liebiao/YAOWENLIEBIAO.json",
    sourceAuthority: "official-agency",
    timelinessTier: "hourly",
    mapping: {
      title: "TITLE",
      url: "URL",
      publishedAt: "DOCRELPUBTIME",
      summary: "SUB_TITLE"
    }
  }, [{
    TITLE: "国务院发布重要政策",
    URL: "https://www.gov.cn/yaowen/liebiao/202605/content_1.htm",
    DOCRELPUBTIME: "2026-05-30",
    SUB_TITLE: "政策摘要"
  }], "2026-05-30T01:00:00.000Z");

  assert.equal(items.length, 1);
  assert.equal(items[0].title, "国务院发布重要政策");
  assert.equal(items[0].publishedAt, "2026-05-30T00:00:00.000Z");
  assert.equal(items[0].sourceAuthority, "official-agency");
  assert.equal(items[0].timelinessTier, "hourly");
});

test("extracts official html and inline-script list items without navigation links", () => {
  const html = `
    <a href="/">首页</a>
    <a href="./202605/t20260529_1.html">国家发展改革委举行新闻发布会</a>
    <script>
      var curHref = './t20260529_620831.html';
      var curTitle ='深交所与投服中心签署新一轮合作备忘录';
    </script>
  `;
  const items = extractHtmlItems({
    url: "https://www.ndrc.gov.cn/xwdt/xwfb/",
    sourceAuthority: "official-agency",
    timelinessTier: "daily",
    includeUrlPattern: "20\\d{6}"
  }, html, "2026-05-30T01:00:00.000Z");

  assert.deepEqual(items.map((item) => item.title), [
    "国家发展改革委举行新闻发布会",
    "深交所与投服中心签署新一轮合作备忘录"
  ]);
  assert.equal(items[0].publishedAt, "2026-05-29T00:00:00.000Z");
});

test("web source health merges with existing rss health and preserves fallback data", () => {
  const result = {
    sourceId: "pbc-news",
    sourceName: "中国人民银行新闻发布",
    sourceType: "webpage",
    sourceAuthority: "official-agency",
    timelinessTier: "hourly",
    category: "finance",
    ok: false,
    fetchedAt: "2026-05-30T01:00:00.000Z",
    error: "timeout"
  };
  const previousResults = [{
    sourceId: "pbc-news",
    sourceName: "中国人民银行新闻发布",
    itemCount: 1,
    fetchedAt: "2026-05-29T01:00:00.000Z",
    items: [{ title: "既有央行新闻", link: "https://example.test/pbc" }]
  }];
  const previousHealth = {
    generatedAt: "2026-05-29T01:00:00.000Z",
    sources: [{ id: "rss-source", name: "RSS Source", status: "healthy" }]
  };

  const effective = buildEffectiveResults([result], previousResults);
  const webHealth = buildSourceHealth([result], { sources: [{ id: "pbc-news", failureCount: 1 }] }, "2026-05-30T01:00:01.000Z");
  const merged = mergeSourceHealth(previousHealth, webHealth);

  assert.equal(effective[0].stale, true);
  assert.equal(effective[0].items[0].title, "既有央行新闻");
  assert.equal(webHealth.sources[0].status, "failed");
  assert.equal(webHealth.sources[0].failureCount, 2);
  assert.equal(merged.sources.length, 2);
});
