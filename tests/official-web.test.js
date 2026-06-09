const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractHtmlItems,
  fetchWebpageSource,
  mapJsonItems,
  limitNewestItems,
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

test("limits webpage source items to fifteen newest records", () => {
  const source = { maxItems: 60 };
  const items = Array.from({ length: 20 }, (_, index) => ({
    title: `Important official update ${index}`,
    link: `https://example.test/${index}`,
    publishedAt: `2026-05-30T${String(index).padStart(2, "0")}:00:00.000Z`
  }));

  const limited = limitNewestItems(items, source, "2026-05-30T20:00:00.000Z");

  assert.equal(limited.length, 15);
  assert.equal(limited[0].publishedAt, "2026-05-30T19:00:00.000Z");
  assert.equal(limited.at(-1).publishedAt, "2026-05-30T05:00:00.000Z");
});

test("webpage source limiting drops records older than forty eight hours", () => {
  const items = [
    { title: "Fresh official item", link: "https://example.test/fresh", publishedAt: "2026-05-30T12:00:00.000Z" },
    { title: "Old official item", link: "https://example.test/old", publishedAt: "2026-05-28T11:59:59.000Z" },
    { title: "Stale 2024 official item", link: "https://example.test/2024", publishedAt: "2024-05-30T12:00:00.000Z" }
  ];

  const limited = limitNewestItems(items, {}, "2026-05-30T12:00:00.000Z");

  assert.deepEqual(limited.map((item) => item.title), ["Fresh official item"]);
});

test("drops webpage links when no real publication date can be parsed", () => {
  const html = `<a href="/csrc/c106311/c7633210/content.shtml">吴清主席会见花旗集团董事会主席兼首席执行官范洁恩</a>`;
  const items = extractHtmlItems({
    url: "https://www.csrc.gov.cn/csrc/xwfb/index.shtml",
    includeUrlPattern: "/csrc/c\\d+/c\\d+/content\\.shtml"
  }, html, "2026-05-31T04:00:00.000Z");

  assert.equal(items.length, 0);
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

test("webpage source retries transient fetch failures before marking failed", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error("fetch failed");
    return {
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      text: async () => `
        <script>
          var curHref = './t20260530_620831.html';
          var curTitle ='Official market update after retry';
        </script>
      `
    };
  };

  try {
    const result = await fetchWebpageSource({
      id: "szse-news",
      name: "SZSE News",
      type: "webpage",
      category: "finance",
      url: "https://www.szse.cn/aboutus/trends/news/index.html",
      maxAgeHours: 6,
      includeUrlPattern: "/aboutus/trends/news/t20\\d{6}_\\d+\\.html"
    }, "2026-05-30T04:00:00.000Z");

    assert.equal(calls, 2);
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 2);
    assert.equal(result.cacheTtlHours, 6);
    assert.equal(result.cacheExpiresAt, "2026-05-30T10:00:00.000Z");
    assert.equal(result.itemCount, 1);
    assert.equal(result.items[0].title, "Official market update after retry");
  } finally {
    global.fetch = originalFetch;
  }
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

test("web source health drops removed sources when active source ids are provided", () => {
  const previousHealth = {
    generatedAt: "2026-05-29T01:00:00.000Z",
    sources: [
      { id: "rss-source", name: "RSS Source", status: "healthy" },
      { id: "sse-news", name: "SSE News", status: "healthy" }
    ]
  };
  const nextHealth = {
    generatedAt: "2026-05-30T01:00:00.000Z",
    sources: [{ id: "yicai-finance", name: "第一财经", status: "healthy" }]
  };

  const merged = mergeSourceHealth(previousHealth, nextHealth, new Set(["rss-source", "yicai-finance"]));

  assert.deepEqual(merged.sources.map((source) => source.id), ["rss-source", "yicai-finance"]);
});

test("web source health keeps previous empty status through transient failures", () => {
  const result = {
    sourceId: "szse-news",
    sourceName: "SZSE News",
    sourceType: "webpage",
    sourceAuthority: "official-market",
    timelinessTier: "daily",
    category: "finance",
    ok: false,
    fetchedAt: "2026-06-02T09:00:00.000Z",
    attempts: 2,
    error: "fetch failed"
  };
  const previousHealth = {
    sources: [{
      id: "szse-news",
      name: "SZSE News",
      category: "finance",
      status: "empty",
      itemCount: 0,
      responseStatus: 200,
      failureCount: 0,
      lastCheckedAt: "2026-06-02T08:30:00.000Z",
      cacheTtlHours: 48,
      cacheStartedAt: "2026-06-02T08:30:00.000Z",
      cacheExpiresAt: "2026-06-04T08:30:00.000Z"
    }]
  };

  const health = buildSourceHealth([result], previousHealth, "2026-06-02T09:00:01.000Z");

  assert.equal(health.sources[0].status, "empty");
  assert.equal(health.sources[0].responseStatus, 200);
  assert.equal(health.sources[0].failureCount, 1);
  assert.equal(health.sources[0].error, null);
  assert.equal(health.sources[0].cacheTtlHours, 48);
  assert.equal(health.sources[0].cacheStartedAt, "2026-06-02T08:30:00.000Z");
  assert.equal(health.sources[0].cacheExpiresAt, "2026-06-04T08:30:00.000Z");
  assert.equal(health.sources[0].latestAttempt.error, "fetch failed");
});

test("web source health marks failed after repeated transient failures", () => {
  const result = {
    sourceId: "szse-news",
    sourceName: "SZSE News",
    sourceType: "webpage",
    sourceAuthority: "official-market",
    timelinessTier: "daily",
    category: "finance",
    ok: false,
    fetchedAt: "2026-06-02T10:00:00.000Z",
    attempts: 2,
    error: "fetch failed"
  };
  const previousHealth = {
    sources: [{
      id: "szse-news",
      name: "SZSE News",
      category: "finance",
      status: "empty",
      itemCount: 0,
      responseStatus: 200,
      failureCount: 2,
      lastCheckedAt: "2026-06-02T09:30:00.000Z"
    }]
  };

  const health = buildSourceHealth([result], previousHealth, "2026-06-02T10:00:01.000Z");

  assert.equal(health.sources[0].status, "failed");
  assert.equal(health.sources[0].responseStatus, null);
  assert.equal(health.sources[0].failureCount, 3);
  assert.equal(health.sources[0].error, "fetch failed");
});

test("does not reuse webpage fallback when latest request succeeds with no dated items", () => {
  const result = {
    sourceId: "csrc-news",
    sourceName: "中国证监会新闻发布",
    sourceType: "webpage",
    category: "finance",
    ok: true,
    status: 200,
    itemCount: 0,
    fetchedAt: "2026-05-31T04:00:00.000Z",
    items: []
  };
  const previousResults = [{
    sourceId: "csrc-news",
    sourceName: "中国证监会新闻发布",
    itemCount: 1,
    fetchedAt: "2026-05-30T04:00:00.000Z",
    items: [{ title: "旧缓存", link: "https://example.test/old", publishedAt: "2026-05-30T04:00:00.000Z" }]
  }];

  const effective = buildEffectiveResults([result], previousResults);
  const health = buildSourceHealth([result], {
    sources: [{ id: "csrc-news", failureCount: 3, lastSuccessAt: "2026-05-30T04:00:00.000Z" }]
  }, "2026-05-31T04:00:01.000Z");

  assert.equal(effective[0].stale, false);
  assert.equal(effective[0].itemCount, 0);
  assert.deepEqual(effective[0].items, []);
  assert.equal(health.sources[0].status, "empty");
  assert.equal(health.sources[0].failureCount, 0);
  assert.equal(health.sources[0].lastSuccessAt, "2026-05-30T04:00:00.000Z");
});
