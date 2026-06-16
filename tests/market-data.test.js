const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeGlobalQuote,
  normalizeTopMovers,
  fetchMarketData
} = require("../scripts/fetch-market-data");

test("normalizes Alpha Vantage global quote responses", () => {
  const quote = normalizeGlobalQuote("NVDA", {
    "Global Quote": {
      "01. symbol": "NVDA",
      "05. price": "125.50",
      "06. volume": "123456",
      "07. latest trading day": "2026-06-15",
      "09. change": "2.50",
      "10. change percent": "2.03%"
    }
  }, "2026-06-16T00:00:00.000Z");

  assert.equal(quote.symbol, "NVDA");
  assert.equal(quote.status, "available");
  assert.equal(quote.price, 125.5);
  assert.equal(quote.changePercent, "2.03%");
  assert.equal(quote.changePercentValue, 2.03);
});

test("normalizes Alpha Vantage top movers", () => {
  const movers = normalizeTopMovers({
    top_gainers: [{ ticker: "NVDA", price: "125", change_percentage: "2.5%" }],
    top_losers: [{ ticker: "TSLA", price: "180", change_percentage: "-3.1%" }]
  });

  assert.deepEqual(movers.map((entry) => entry.symbol), ["NVDA", "TSLA"]);
  assert.equal(movers[0].direction, "gainer");
  assert.equal(movers[1].changePercentValue, -3.1);
});

test("missing Alpha Vantage key writes unconfigured context without failing", async () => {
  const outputPath = path.join(os.tmpdir(), `market-context-${Date.now()}-missing.json`);
  const data = await fetchMarketData({
    env: {},
    outputPath,
    previousPath: outputPath,
    generatedAt: "2026-06-16T00:00:00.000Z"
  });

  assert.equal(data.status, "unconfigured");
  assert.equal(data.stale, true);
  assert.equal(JSON.parse(fs.readFileSync(outputPath, "utf8")).status, "unconfigured");
});

test("Alpha Vantage limit preserves previous market context as stale", async () => {
  const outputPath = path.join(os.tmpdir(), `market-context-${Date.now()}-stale.json`);
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: "2026-06-15T00:00:00.000Z",
    provider: "alpha-vantage",
    status: "available",
    stale: false,
    symbols: { NVDA: { symbol: "NVDA", status: "available", price: 120 } },
    topMovers: [],
    newsSentiment: {}
  }));

  const data = await fetchMarketData({
    env: { ALPHA_VANTAGE_API_KEY: "test-key" },
    outputPath,
    previousPath: outputPath,
    symbols: ["NVDA"],
    generatedAt: "2026-06-16T00:00:00.000Z",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ Note: "API call frequency exceeded." })
    })
  });

  assert.equal(data.status, "stale");
  assert.equal(data.stale, true);
  assert.equal(data.symbols.NVDA.price, 120);
});
