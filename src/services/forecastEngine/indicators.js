/**
 * Standard technical indicators, computed by hand — same textbook formulas
 * as the original Python (pandas) version, ported to plain arrays so no
 * heavy numerical library is needed. `bars` is an array of
 * { date, open, high, low, close, volume }, oldest first.
 */

function rollingMean(values, window, i) {
  if (i < window - 1) return null;
  let sum = 0;
  for (let j = i - window + 1; j <= i; j++) sum += values[j];
  return sum / window;
}

function rollingStd(values, window, i) {
  const mean = rollingMean(values, window, i);
  if (mean == null) return null;
  let sumSq = 0;
  for (let j = i - window + 1; j <= i; j++) sumSq += (values[j] - mean) ** 2;
  // Sample std (ddof=1), matching pandas' default .std().
  return window > 1 ? Math.sqrt(sumSq / (window - 1)) : 0;
}

// Exponential moving average, adjust=False semantics (same as pandas' .ewm(span=..., adjust=False)).
function ewm(values, span) {
  const alpha = 2 / (span + 1);
  const out = new Array(values.length);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) {
      out[i] = prev;
      continue;
    }
    prev = prev == null ? values[i] : alpha * values[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function addIndicators(bars) {
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const n = bars.length;

  // --- RSI (14-day) ---
  const gains = new Array(n).fill(0);
  const losses = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const delta = closes[i] - closes[i - 1];
    gains[i] = delta > 0 ? delta : 0;
    losses[i] = delta < 0 ? -delta : 0;
  }
  const rsi = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const avgGain = rollingMean(gains, 14, i);
    const avgLoss = rollingMean(losses, 14, i);
    if (avgGain == null || avgLoss == null) {
      rsi[i] = 50; // neutral when undefined, matches original fillna(50)
      continue;
    }
    if (avgLoss === 0) {
      rsi[i] = avgGain === 0 ? 50 : 100;
      continue;
    }
    const rs = avgGain / avgLoss;
    rsi[i] = 100 - 100 / (1 + rs);
  }

  // --- MACD (12, 26, 9) ---
  const ema12 = ewm(closes, 12);
  const ema26 = ewm(closes, 26);
  const macd = closes.map((_, i) => ema12[i] - ema26[i]);
  const macdSignal = ewm(macd, 9);
  const macdHist = macd.map((v, i) => v - macdSignal[i]);

  // --- Moving averages ---
  const sma20 = closes.map((_, i) => rollingMean(closes, 20, i));
  const sma50 = closes.map((_, i) => rollingMean(closes, 50, i));

  // --- Bollinger Bands (20-day, 2 std) ---
  const bbStd = closes.map((_, i) => rollingStd(closes, 20, i));
  const bbUpper = sma20.map((mid, i) => (mid == null || bbStd[i] == null ? null : mid + 2 * bbStd[i]));
  const bbLower = sma20.map((mid, i) => (mid == null || bbStd[i] == null ? null : mid - 2 * bbStd[i]));

  // --- Volume trend (20-day avg vs current) ---
  const volAvg20 = volumes.map((_, i) => rollingMean(volumes, 20, i));
  const volRatio = volumes.map((v, i) => (volAvg20[i] ? v / volAvg20[i] : null));

  // --- Daily volatility (20-day rolling std of returns) ---
  const returns = closes.map((c, i) => (i === 0 || !closes[i - 1] ? null : c / closes[i - 1] - 1));
  const volatility20 = returns.map((_, i) => (i < 20 ? null : rollingStd(returns.map((r) => r ?? 0), 20, i)));

  return bars.map((bar, i) => ({
    ...bar,
    RSI: rsi[i],
    MACD: macd[i],
    MACD_signal: macdSignal[i],
    MACD_hist: macdHist[i],
    SMA20: sma20[i],
    SMA50: sma50[i],
    BB_mid: sma20[i],
    BB_upper: bbUpper[i],
    BB_lower: bbLower[i],
    Vol_avg20: volAvg20[i],
    Vol_ratio: volRatio[i],
    Returns: returns[i],
    Volatility20: volatility20[i],
  }));
}

/**
 * Turns today's indicator readings into a discrete "setup label". Rows get
 * bucketed into a small number of setups so we can backtest "how often has
 * THIS setup led to a price rise historically" — this is what makes the
 * confidence score honest instead of invented: a direct historical
 * frequency, not a model's self-reported certainty.
 */
function classifySetup(row) {
  const rsiBucket = row.RSI < 35 ? "oversold" : row.RSI > 65 ? "overbought" : "neutral";
  const macdBucket = row.MACD_hist > 0 ? "bullish_cross" : "bearish_cross";
  const trendBucket = row.SMA20 != null && row.SMA50 != null && row.SMA20 > row.SMA50 ? "uptrend" : "downtrend";
  return `${rsiBucket}|${macdBucket}|${trendBucket}`;
}

// Human-readable explanation of the current technical reading.
function plainEnglishBasis(row) {
  const parts = [];
  if (row.RSI < 35) {
    parts.push(`RSI is ${row.RSI.toFixed(0)} (oversold territory — stock may be undervalued short-term)`);
  } else if (row.RSI > 65) {
    parts.push(`RSI is ${row.RSI.toFixed(0)} (overbought territory — stock may be due for a pullback)`);
  } else {
    parts.push(`RSI is ${row.RSI.toFixed(0)} (neutral)`);
  }

  if (row.MACD_hist > 0) {
    parts.push("MACD is above its signal line (bullish momentum)");
  } else {
    parts.push("MACD is below its signal line (bearish momentum)");
  }

  if (row.SMA20 != null && row.SMA50 != null) {
    parts.push(
      row.SMA20 > row.SMA50
        ? "20-day average is above the 50-day average (short-term uptrend)"
        : "20-day average is below the 50-day average (short-term downtrend)"
    );
  }

  return parts.join("; ") + ".";
}

module.exports = { addIndicators, classifySetup, plainEnglishBasis, rollingMean, rollingStd, ewm };
