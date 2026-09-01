const { fetchHistory } = require("./data");
const { generateForecast } = require("./forecast");

/**
 * Broader market screener — scans a larger universe of stocks (not just
 * the watchlist) and surfaces ones with notable technical signals today.
 *
 * IMPORTANT honesty rule: results from here are labeled "discovered" and
 * kept visually/structurally separate from watchlist predictions in the
 * frontend. Scanning 25+ stocks daily produces more false positives than a
 * curated watchlist chosen deliberately — always make clear these are
 * noisier.
 */

// A reasonably liquid default universe (NSE large/mid-caps). Edit freely —
// this is a sane starting list, not something sacred.
const DEFAULT_UNIVERSE = [
  "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
  "HINDUNILVR.NS", "SBIN.NS", "BHARTIARTL.NS", "ITC.NS", "KOTAKBANK.NS",
  "LT.NS", "AXISBANK.NS", "BAJFINANCE.NS", "MARUTI.NS", "SUNPHARMA.NS",
  "TITAN.NS", "ONGC.NS", "NTPC.NS", "WIPRO.NS", "ADANIENT.NS",
  "TATAMOTORS.NS", "TATASTEEL.NS", "POWERGRID.NS", "ULTRACEMCO.NS", "ASIANPAINT.NS",
];

/**
 * Run generateForecast across a list of tickers (defaults to
 * DEFAULT_UNIVERSE). Returns only ones at/above minConfidence, sorted by
 * confidence descending. Does NOT write to the database — this is a
 * read-only "what's interesting right now" scan.
 */
async function scanUniverse({ tickers, minConfidence = 60.0 } = {}) {
  const universe = tickers || DEFAULT_UNIVERSE;
  const hits = [];
  const errors = [];

  for (const ticker of universe) {
    try {
      const bars = await fetchHistory(ticker, { days: 730 });
      const result = generateForecast(bars, ticker);
      result.source = "discovered"; // never let this look like a watchlist pick
      if (result.technicalConfidence >= minConfidence && result.technicalDirection !== "neutral") {
        hits.push(result);
      }
    } catch (err) {
      errors.push({ ticker, error: err.message });
    }
  }

  hits.sort((a, b) => b.technicalConfidence - a.technicalConfidence);
  return { hits, scanned: universe.length, errors };
}

module.exports = { scanUniverse, DEFAULT_UNIVERSE };
