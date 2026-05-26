(function () {
  const FALLBACK_CONFIG = {
    siteName: "Message Choose",
    tagline: "科技、金融、新闻信息筛选台",
    defaultLimit: 8,
    defaultSort: "score-desc",
    scoreFloor: 60,
    channels: [
      { id: "tech", label: "科技", description: "AI、云计算、芯片、开发者平台与安全基础设施。" },
      { id: "finance", label: "金融", description: "央行、监管、市场结构、宏观数据与风险信号。" },
      { id: "news", label: "新闻", description: "公共政策、国际事件、社会治理与重大突发消息。" }
    ]
  };

  const FALLBACK_DATA = {
    siteName: "Message Choose",
    generatedAt: "2026-05-24T00:00:00.000Z",
    totalItems: 3,
    channels: {
      tech: { label: "科技", count: 1, items: [] },
      finance: { label: "金融", count: 1, items: [] },
      news: { label: "新闻", count: 1, items: [] }
    },
    items: [
      {
        id: "fallback-tech",
        title: "AI infrastructure teams shift spending toward inference platforms",
        url: "https://example.com/tech/ai-inference-platforms",
        source: "TechCrunch",
        sourceType: "rss",
        category: "tech",
        publishedAt: "2026-05-23T13:00:00.000Z",
        summary: "Cloud providers and model developers are paying closer attention to inference cost, latency and security.",
        score: 92,
        tags: ["AI", "cloud"],
        duplicateCount: 1
      },
      {
        id: "fallback-finance",
        title: "Central bank officials outline bank supervision priorities",
        url: "https://example.com/finance/supervision-priorities",
        source: "Federal Reserve",
        sourceType: "rss",
        category: "finance",
        publishedAt: "2026-05-23T10:30:00.000Z",
        summary: "Officials emphasized liquidity monitoring, cyber resilience and market structure risks.",
        score: 90,
        tags: ["policy", "risk"],
        duplicateCount: 0
      },
      {
        id: "fallback-news",
        title: "Election officials publish final timeline for national vote",
        url: "https://example.com/news/election-timeline",
        source: "BBC World",
        sourceType: "rss",
        category: "news",
        publishedAt: "2026-05-23T08:20:00.000Z",
        summary: "The timetable clarifies registration windows, observer access and reporting checkpoints.",
        score: 78,
        tags: ["election"],
        duplicateCount: 0
      }
    ]
  };

  const FALLBACK_HEALTH = {
    sources: [
      { name: "TechCrunch", category: "tech", status: "healthy", failureCount: 0 },
      { name: "Federal Reserve", category: "finance", status: "healthy", failureCount: 0 },
      { name: "BBC World", category: "news", status: "healthy", failureCount: 0 }
    ]
  };

  async function loadJson(url, fallback) {
    if (window.location.protocol === "file:") return fallback;

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch {
      return fallback;
    }
  }

  function formatGeneratedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "数据时间未知";
    return `更新 ${new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date)}`;
  }

  function updateSummary(data, filteredItems) {
    document.getElementById("generated-at").textContent = formatGeneratedAt(data.generatedAt);
    document.getElementById("total-count").textContent = `${filteredItems.length} 条`;
    document.getElementById("result-summary").textContent = `当前显示 ${filteredItems.length} 条，数据池 ${data.totalItems || data.items.length} 条。`;
  }

  async function init() {
    const [config, data, health] = await Promise.all([
      loadJson("public/site-config.json", FALLBACK_CONFIG),
      loadJson("src/data/latest-items.json", FALLBACK_DATA),
      loadJson("src/data/source-health.json", FALLBACK_HEALTH)
    ]);

    const feed = document.getElementById("feed");
    const summary = document.getElementById("channel-summary");
    const sourceStatus = document.getElementById("source-status");

    window.MessageChooseRender.renderChannelSummary(summary, data);
    window.MessageChooseSourceStatus.renderSourceStatus(sourceStatus, health);
    window.MessageChooseFilters.initFilters(config, data, (state) => {
      const filteredItems = window.MessageChooseFilters.applyFilters(data.items || [], state);
      window.MessageChooseRender.renderFeed(feed, filteredItems);
      updateSummary(data, filteredItems);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
