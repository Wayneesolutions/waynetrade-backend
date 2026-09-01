const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { rollingMean, rollingStd, ewm, classifySetup, addIndicators } = require("../src/services/forecastEngine/indicators");

/**
 * Pure-math port of saaf-signal-backend's indicators.py. These tests verify
 * the JS port against hand-computed values, not against a real market data
 * fetch (see forecastEngine/data.js's own honest-gap comment — this
 * sandbox can't reach Yahoo Finance).
 */

describe("rollingMean / rollingStd", () => {
  const values = [1, 2, 3, 4, 5];

  test("null before the window fills", () => {
    assert.equal(rollingMean(values, 3, 0), null);
    assert.equal(rollingMean(values, 3, 1), null);
  });

  test("matches hand-computed rolling averages once the window fills", () => {
    assert.equal(rollingMean(values, 3, 2), 2); // mean(1,2,3)
    assert.equal(rollingMean(values, 3, 3), 3); // mean(2,3,4)
    assert.equal(rollingMean(values, 3, 4), 4); // mean(3,4,5)
  });

  test("sample std dev (ddof=1) matches hand-computed values", () => {
    // mean(1,2,3)=2, variance = ((1)^2+(0)^2+(1)^2)/(3-1) = 1, std = 1
    assert.equal(rollingStd(values, 3, 2), 1);
    assert.equal(rollingStd(values, 3, 3), 1);
  });
});

describe("ewm (exponential moving average, adjust=False)", () => {
  test("matches hand-computed EMA for a 3-point series", () => {
    const out = ewm([10, 20, 30], 2); // alpha = 2/3
    assert.equal(out[0], 10);
    assert.ok(Math.abs(out[1] - 16.6667) < 0.001);
    assert.ok(Math.abs(out[2] - 25.5556) < 0.001);
  });
});

describe("classifySetup", () => {
  test("oversold + bullish MACD + uptrend", () => {
    const label = classifySetup({ RSI: 30, MACD_hist: 1, SMA20: 110, SMA50: 100 });
    assert.equal(label, "oversold|bullish_cross|uptrend");
  });

  test("overbought + bearish MACD + downtrend", () => {
    const label = classifySetup({ RSI: 70, MACD_hist: -1, SMA20: 90, SMA50: 100 });
    assert.equal(label, "overbought|bearish_cross|downtrend");
  });

  test("neutral RSI, zero MACD_hist counts as bearish_cross (strictly > required for bullish)", () => {
    const label = classifySetup({ RSI: 50, MACD_hist: 0, SMA20: null, SMA50: null });
    assert.equal(label, "neutral|bearish_cross|downtrend");
  });
});

describe("addIndicators", () => {
  // A smooth, deterministic synthetic series — enough bars for every
  // indicator's warm-up window (RSI 14, SMA50 50) to produce real values.
  function syntheticBars(n) {
    const bars = [];
    for (let i = 0; i < n; i++) {
      const close = 100 + 10 * Math.sin(i / 10) + i * 0.05;
      bars.push({
        date: new Date(2024, 0, 1 + i),
        open: close - 0.5,
        high: close + 1,
        low: close - 1,
        close,
        volume: 100000 + (i % 5) * 1000,
      });
    }
    return bars;
  }

  test("RSI stays within [0, 100] and MACD_hist = MACD - MACD_signal for every bar", () => {
    const bars = addIndicators(syntheticBars(80));
    for (const bar of bars) {
      assert.ok(bar.RSI >= 0 && bar.RSI <= 100, `RSI out of bounds: ${bar.RSI}`);
      assert.ok(Math.abs(bar.MACD_hist - (bar.MACD - bar.MACD_signal)) < 1e-9);
    }
  });

  test("SMA20/SMA50 are null before their window fills, defined after", () => {
    const bars = addIndicators(syntheticBars(60));
    assert.equal(bars[18].SMA20, null);
    assert.ok(bars[19].SMA20 != null);
    assert.equal(bars[48].SMA50, null);
    assert.ok(bars[49].SMA50 != null);
  });
});
