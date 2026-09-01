const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { explain } = require("../src/services/forecastEngine/plainEnglish");

describe("explain", () => {
  const pred = {
    ticker: "RELIANCE.NS",
    technicalDirection: "bullish",
    predictedLow: 2400,
    predictedHigh: 2600,
    horizonDays: 5,
  };

  test("includes the disclaimer and the predicted range, always", () => {
    const text = explain(pred, { totalChecked: 0 });
    assert.match(text, /not financial advice/i);
    assert.match(text, /2400/);
    assert.match(text, /2600/);
  });

  test("cites the accuracy stat once there's enough tracked history", () => {
    const text = explain(pred, { totalChecked: 12, accuracyPct: 61.5 });
    assert.match(text, /61\.5% of the time across 12 checked predictions/);
  });

  test("says explicitly there isn't enough history yet below the threshold", () => {
    const text = explain(pred, { totalChecked: 2, accuracyPct: 100 });
    assert.match(text, /don't have enough tracked history/i);
  });
});
