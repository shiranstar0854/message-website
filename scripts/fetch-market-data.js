const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");
const MARKET_CONTEXT_PATH = path.join(ROOT_DIR, "src", "data", "market-context.json");
const DEFAULT_SYMBOLS = ["NVDA", "MSFT", "GOOGL", "META", "AMZN", "AMD", "AVGO", "TSLA", "QQQ", "SPY", "SMH"];
const ALPHA_VANTAGE_ENDPOINT = "https://www.alphavantage.co/query";
const DEFAULT_REQUEST_DELAY_MS = 1200;
const DEFAULT_SENTIMENT_SYMBOL_LIMIT = 3;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const requestDelayMs = Number(options.requestDelayMs ?? env.ALPHA_VANTAGE_REQUEST_DELAY_MS ?? DEFAULT_REQUEST_DELAY_MS);
  const sentimentSymbolLimit = Number(options.sentimentSymbolLimit ?? env.ALPHA_VANTAGE_SENTIMENT_SYMBOL_LIMIT ?? DEFAULT_SENTIMENT_SYMBOL_LIMIT);

  if (!apiKey || !fetchImpl) {
    const fallback = previous
      ? { ...previous, status: "unconfigured", stale: true, message: "ALPHA_VANTAGE_API_KEY is not configured.", generatedAt }
      : buildFallbackContext("unconfigured", generatedAt, "ALPHA_VANTAGE_API_KEY is not configured.");
    writeJson(outputPath, fallback);
    return fallback;
  }

  let requestCount = 0;
  async function request(functionName, params) {
    if (requestDelayMs > 0 && requestCount > 0) await sleep(requestDelayMs);
    requestCount += 1;
    return fetchAlphaVantage(functionName, params, apiKey, fetchImpl);
  }

  const errors = [];
  const symbolQuotes = {};
  const newsSentiment = {};
  let topMovers = [];

  for (const symbol of symbols) {
    try {
      const quote = await request("GLOBAL_QUOTE", { symbol });
      symbolQuotes[symbol] = normalizeGlobalQuote(symbol, quote, generatedAt);
    } catch (error) {
      errors.push(`GLOBAL_QUOTE ${symbol}: ${error.message}`);
      break;
    }
  }

  if (Object.keys(symbolQuotes).length === 0) {
    const fallback = previous
      ? { ...previous, status: "stale", stale: true, message: errors.join("; ") || "Alpha Vantage returned no usable quote data.", generatedAt }
      : buildFallbackContext("stale", generatedAt, errors.join("; ") || "Alpha Vantage returned no usable quote data.");
    writeJson(outputPath, fallback);
    return fallback;
  }

  try {
    topMovers = normalizeTopMovers(await request("TOP_GAINERS_LOSERS", {}));
  } catch (error) {
    errors.push(`TOP_GAINERS_LOSERS: ${error.message}`);
  }

  for (const symbol of symbols.slice(0, Math.max(0, sentimentSymbolLimit))) {
    try {
      const sentiment = await request("NEWS_SENTIMENT", { tickers: symbol, limit: "8" });
      newsSentiment[symbol] = normalizeNewsSentiment(symbol, sentiment);
    } catch (error) {
      errors.push(`NEWS_SENTIMENT ${symbol}: ${error.message}`);
      break;
    }
  }

  const data = {
    generatedAt,
    provider: "alpha-vantage",
    status: errors.length ? "partial" : "available",
    stale: false,
    message: errors.join("; "),
    symbols: symbolQuotes,
    topMovers,
    newsSentiment
  };
  writeJson(outputPath, data);
  return data;
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
