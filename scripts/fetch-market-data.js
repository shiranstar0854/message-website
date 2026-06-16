const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");
const MARKET_CONTEXT_PATH = path.join(ROOT_DIR, "src", "data", "market-context.json");
const DEFAULT_SYMBOLS = ["NVDA", "MSFT", "GOOGL", "META", "AMZN", "AMD", "AVGO", "TSLA", "QQQ", "SPY", "SMH"];
const ALPHA_VANTAGE_ENDPOINT = "https://www.alphavantage.co/query";

function percentNumber(value) {
  const number = Number(String(value || "").replace("%", ""));
  return Number.isFinite(number) ? number : null;
}

function numberValue(value) {
  const number = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function normalizeGlobalQuote(symbol, response = {}, fetchedAt = new Date().toISOString()) {
  const quote = response["Global Quote"] || response.globalQuote || response;
  const price = numberValue(quote["05. price"] || quote.price);
  const change = numberValue(quote["09. change"] || quote.change);
  const changePercent = quote["10. change percent"] || quote.changePercent || quote.change_percentage || "";
  const tradingDay = quote["07. latest trading day"] || quote.latestTradingDay || quote.tradingDay || "";
  if (!price && !changePercent && !tradingDay) {
    return {
      symbol,
      status: "missing",
      fetchedAt
    };
  }
  return {
    symbol,
    status: "available",
    price,
    change,
    changePercent,
    changePercentValue: percentNumber(changePercent),
    volume: numberValue(quote["06. volume"] || quote.volume),
    tradingDay,
    fetchedAt
  };
}

function normalizeMover(entry = {}) {
  const symbol = entry.ticker || entry.symbol || "";
  return {
    symbol,
    price: numberValue(entry.price),
    changeAmount: numberValue(entry.change_amount || entry.changeAmount),
    changePercent: entry.change_percentage || entry.changePercent || "",
    changePercentValue: percentNumber(entry.change_percentage || entry.changePercent),
    volume: numberValue(entry.volume)
  };
}

function normalizeTopMovers(response = {}) {
  return [
    ...(response.top_gainers || []).map((entry) => ({ ...normalizeMover(entry), direction: "gainer" })),
    ...(response.top_losers || []).map((entry) => ({ ...normalizeMover(entry), direction: "loser" })),
    ...(response.most_actively_traded || []).map((entry) => ({ ...normalizeMover(entry), direction: "active" }))
  ].filter((entry) => entry.symbol);
}

function normalizeNewsSentiment(symbol, response = {}) {
  const feed = Array.isArray(response.feed) ? response.feed : [];
  return feed.slice(0, 8).map((entry) => ({
    symbol,
    title: entry.title || "",
    url: entry.url || "",
    source: entry.source || "",
    timePublished: entry.time_published || "",
    summary: entry.summary || "",
    overallSentimentScore: numberValue(entry.overall_sentiment_score),
    overallSentimentLabel: entry.overall_sentiment_label || ""
  }));
}

function isAlphaVantageLimit(response = {}) {
  return Boolean(response.Note || response.Information || response["Error Message"]);
}

function buildFallbackContext(status, generatedAt, message = "") {
  return {
    generatedAt,
    provider: "alpha-vantage",
    status,
    stale: status !== "available",
    message,
    symbols: {},
    topMovers: [],
    newsSentiment: {}
  };
}

async function fetchAlphaVantage(functionName, params, apiKey, fetchImpl) {
  const url = new URL(ALPHA_VANTAGE_ENDPOINT);
  url.searchParams.set("function", functionName);
  Object.entries(params || {}).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set("apikey", apiKey);
  const response = await fetchImpl(url.toString());
  if (!response.ok) throw new Error(`Alpha Vantage ${functionName} failed with HTTP ${response.status}`);
  const json = await response.json();
  if (isAlphaVantageLimit(json)) {
    throw new Error(json.Note || json.Information || json["Error Message"]);
  }
  return json;
}

async function fetchMarketData(options = {}) {
  const env = options.env || process.env;
  const apiKey = env.ALPHA_VANTAGE_API_KEY;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const outputPath = options.outputPath || MARKET_CONTEXT_PATH;
  const previousPath = options.previousPath || outputPath;
  const previous = readJson(previousPath, null);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const symbols = options.symbols || DEFAULT_SYMBOLS;

  if (!apiKey || !fetchImpl) {
    const fallback = previous
      ? { ...previous, status: "unconfigured", stale: true, message: "ALPHA_VANTAGE_API_KEY is not configured.", generatedAt }
      : buildFallbackContext("unconfigured", generatedAt, "ALPHA_VANTAGE_API_KEY is not configured.");
    writeJson(outputPath, fallback);
    return fallback;
  }

  try {
    const symbolQuotes = {};
    for (const symbol of symbols) {
      const quote = await fetchAlphaVantage("GLOBAL_QUOTE", { symbol }, apiKey, fetchImpl);
      symbolQuotes[symbol] = normalizeGlobalQuote(symbol, quote, generatedAt);
    }
    const topMovers = normalizeTopMovers(await fetchAlphaVantage("TOP_GAINERS_LOSERS", {}, apiKey, fetchImpl));
    const newsSentiment = {};
    for (const symbol of symbols.slice(0, 8)) {
      const sentiment = await fetchAlphaVantage("NEWS_SENTIMENT", { tickers: symbol, limit: "8" }, apiKey, fetchImpl);
      newsSentiment[symbol] = normalizeNewsSentiment(symbol, sentiment);
    }
    const data = {
      generatedAt,
      provider: "alpha-vantage",
      status: "available",
      stale: false,
      symbols: symbolQuotes,
      topMovers,
      newsSentiment
    };
    writeJson(outputPath, data);
    return data;
  } catch (error) {
    const fallback = previous
      ? { ...previous, status: "stale", stale: true, message: error.message, generatedAt }
      : buildFallbackContext("stale", generatedAt, error.message);
    writeJson(outputPath, fallback);
    return fallback;
  }
}

if (require.main === module) {
  fetchMarketData()
    .then((data) => {
      console.log(`Market context status: ${data.status}.`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_SYMBOLS,
  normalizeGlobalQuote,
  normalizeTopMovers,
  normalizeNewsSentiment,
  fetchMarketData
};
