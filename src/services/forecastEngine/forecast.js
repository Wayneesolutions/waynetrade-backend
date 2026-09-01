const { addIndicators, classifySetup, plainEnglishBasis } = require("./indicators");

/**
 * The core honesty engine — ported from saaf-signal-backend's forecast.py.
 *
 * Instead of a black-box model outputting "87% confidence" from nowhere:
 * 1. Look at today's technical setup (RSI/MACD/trend bucket).
 * 2. Scan the stock's own history for every past day with the SAME setup.
 * 3. Check what actually happened over the next N trading days after each
 *    historical occurrence.
 * 4. The confidence score IS that historical hit rate. Not invented.
 * 5. The predicted price range comes from the historical distribution of
 *    outcomes for this setup, not a guess.
 *
 * If a setup has fewer than MIN_SAMPLES historical occurrences, we say so
 * explicitly and cap confidence low — we do not pretend to know.
 */

const MIN_SAMPLES = 8; // minimum historical occurrences of a setup before we trust it
const HORIZON_DAYS = 5; // trading days ahead we're forecasting

/**
 * Scan all rows (excluding the most recent `horizon` days, since we can't
 * know their forward outcome yet) that match currentSetup. Returns hit
 * rate, average forward return, and std dev of forward return.
 */
function backtestSetup(rows, currentSetup, horizon = HORIZON_DAYS) {
  const withSetup = rows.map((row, i) => {
    const future = rows[i + horizon];
    const fwdReturn = future ? future.close / row.close - 1 : null;
    return { ...row, setup: classifySetup(row), fwdReturn };
  });

  const matches = withSetup.filter((r) => r.setup === currentSetup && r.fwdReturn != null);
  const n = matches.length;
  if (n === 0) {
    return { nSamples: 0, hitRate: null, avgReturn: null, stdReturn: null };
  }

  const upMoves = matches.filter((r) => r.fwdReturn > 0).length;
  const hitRate = upMoves / n;
  const avgReturn = matches.reduce((sum, r) => sum + r.fwdReturn, 0) / n;

  let stdReturn;
  if (n > 1) {
    const variance = matches.reduce((sum, r) => sum + (r.fwdReturn - avgReturn) ** 2, 0) / (n - 1);
    stdReturn = Math.sqrt(variance);
  } else {
    stdReturn = Math.abs(avgReturn) * 0.5;
  }
  if (Number.isNaN(stdReturn)) stdReturn = 0.02;

  return { nSamples: n, hitRate, avgReturn, stdReturn };
}

function horizonWord(hitRate, nSamples) {
  const upCount = Math.round(hitRate * nSamples);
  return `${upCount} out of ${nSamples} times`;
}

// bars: raw OHLCV array (oldest first), at least ~1-2 years of daily data
// for a meaningful backtest.
function generateForecast(bars, ticker) {
  const withIndicators = addIndicators(bars).filter(
    (r) => r.RSI != null && r.MACD_hist != null && r.SMA20 != null && r.SMA50 != null
  );

  if (withIndicators.length < 60) {
    throw new Error(`Not enough historical data for ${ticker} to backtest reliably.`);
  }

  const latest = withIndicators[withIndicators.length - 1];
  const prev = withIndicators.length >= 2 ? withIndicators[withIndicators.length - 2] : latest;
  const currentPrice = Number(latest.close);
  const priceChangePct = prev.close ? Math.round(((currentPrice - prev.close) / prev.close) * 10000) / 100 : 0;
  const currentSetup = classifySetup(latest);

  // Exclude today itself from the backtest population.
  const historical = withIndicators.slice(0, -1);
  const stats = backtestSetup(historical, currentSetup);

  let direction, confidence, avgReturn, stdReturn, basis;

  if (stats.nSamples < MIN_SAMPLES) {
    // Honest fallback: not enough history for this exact setup. Say so
    // plainly rather than inventing a number.
    direction = "neutral";
    confidence = 30.0; // deliberately low — flagging low reliability, not "no signal"
    avgReturn = 0.0;
    const returns = withIndicators.map((r) => r.Returns).filter((r) => r != null);
    const meanReturn = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    stdReturn =
      returns.length > 1
        ? Math.sqrt(returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length - 1))
        : 0.02;
    if (Number.isNaN(stdReturn)) stdReturn = 0.02;
    basis =
      plainEnglishBasis(latest) +
      ` This exact setup has only occurred ${stats.nSamples} times in the available history — ` +
      `too few to trust a confidence number, so confidence is capped low until more data accumulates.`;
  } else {
    const { hitRate } = stats;
    avgReturn = stats.avgReturn;
    stdReturn = stats.stdReturn;
    direction = hitRate > 0.55 ? "bullish" : hitRate < 0.45 ? "bearish" : "neutral";
    // Confidence = how far the hit rate is from a coin flip, scaled to
    // 0-100, capped — never claim above 85% because markets are not that
    // predictable.
    const rawConfidence = 50 + (hitRate - 0.5) * 100;
    confidence = Math.min(85.0, Math.max(15.0, rawConfidence));
    basis =
      plainEnglishBasis(latest) +
      ` This exact setup has occurred ${stats.nSamples} times in this stock's available history, ` +
      `and price was higher ${horizonWord(hitRate, stats.nSamples)} ${HORIZON_DAYS} trading days later.`;
  }

  const predictedLow = currentPrice * (1 + avgReturn - stdReturn);
  const predictedHigh = currentPrice * (1 + avgReturn + stdReturn);

  return {
    ticker,
    priceAtPrediction: currentPrice,
    priceChangePct,
    technicalDirection: direction,
    technicalConfidence: Math.round(confidence * 10) / 10,
    technicalBasis: basis,
    predictedLow: Math.round(predictedLow * 100) / 100,
    predictedHigh: Math.round(predictedHigh * 100) / 100,
    horizonDays: HORIZON_DAYS,
    nSamples: stats.nSamples,
  };
}

module.exports = { generateForecast, backtestSetup, MIN_SAMPLES, HORIZON_DAYS };
