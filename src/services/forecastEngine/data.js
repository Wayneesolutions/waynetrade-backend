const YahooFinance = require("yahoo-finance2").default;

let yahooFinance = null;
function getClient() {
  if (!yahooFinance) yahooFinance = new YahooFinance();
  return yahooFinance;
}

/**
 * Data fetching for the forecast engine. yahoo-finance2 wraps Yahoo's
 * unofficial (but reliable, free, no-API-key) chart endpoint — same data
 * source the original saaf-signal-backend used via Python's yfinance.
 *
 * HONEST GAP: never exercised against a real network call in this sandbox
 * — the sandbox's egress proxy blocks query1/query2.finance.yahoo.com (same
 * organization-policy block that also stops Render/Vercel API calls from
 * here, confirmed separately). The math in indicators.js/forecast.js is
 * tested against synthetic OHLCV fixtures instead — verify this module
 * against a real ticker once it's deployed somewhere with normal internet
 * access.
 */

// Indian stocks: append .NS (NSE) or .BO (BSE), e.g. "RELIANCE.NS", "TCS.NS".
// US stocks: plain ticker, e.g. "AAPL".
async function fetchHistory(ticker, { days = 730 } = {}) {
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - days * 24 * 60 * 60 * 1000);

  const result = await getClient().chart(ticker, {
    period1,
    period2,
    interval: "1d",
  });

  const bars = (result?.quotes || [])
    .filter((q) => q.close != null && q.open != null && q.high != null && q.low != null)
    .map((q) => ({
      date: q.date,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume ?? 0,
    }));

  if (bars.length === 0) {
    throw new Error(`No data returned for ticker '${ticker}'. Check the symbol.`);
  }
  return bars;
}

// Latest close price — used by the outcome checker.
async function fetchCurrentPrice(ticker) {
  const quote = await getClient().quote(ticker);
  if (!quote || quote.regularMarketPrice == null) {
    throw new Error(`No recent data for '${ticker}'.`);
  }
  return Number(quote.regularMarketPrice);
}

module.exports = { fetchHistory, fetchCurrentPrice };
