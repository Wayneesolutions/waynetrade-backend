const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { computeTakeProfit } = require("../src/services/riskEngine");

/**
 * computeTakeProfit is the auto-profit-booking math — the one place a
 * silent bug would be hardest to notice (wrong take-profit levels don't
 * throw, they just quietly cost money). Pure function, no DB/network, so
 * this is cheap to cover thoroughly.
 */
describe("computeTakeProfit", () => {
  test("honors an explicit takeProfit on the signal, ignoring the ratio entirely", () => {
    const result = computeTakeProfit({
      payload: { side: "buy", price: 2450, stopLoss: 2400, takeProfit: 9999 },
      riskProfile: { riskRewardRatio: 2 },
    });
    assert.equal(result, 9999);
  });

  test("auto-computes for a buy: price + ratio * (price - stopLoss)", () => {
    // Same numbers verified end-to-end against a real Postgres this
    // session: 2450 entry, 2400 stop, ratio 2.5 -> 2575.
    const result = computeTakeProfit({
      payload: { side: "buy", price: 2450, stopLoss: 2400 },
      riskProfile: { riskRewardRatio: 2.5 },
    });
    assert.equal(result, 2575);
  });

  test("auto-computes for a sell: price - ratio * (stopLoss - price)", () => {
    const result = computeTakeProfit({
      payload: { side: "sell", price: 2400, stopLoss: 2450 },
      riskProfile: { riskRewardRatio: 2 },
    });
    assert.equal(result, 2300);
  });

  test("returns null when there's no reference price on the signal", () => {
    const result = computeTakeProfit({
      payload: { side: "buy", stopLoss: 2400 },
      riskProfile: { riskRewardRatio: 2 },
    });
    assert.equal(result, null);
  });

  test("returns null when the member's risk profile has no ratio (profit-booking disabled)", () => {
    const result = computeTakeProfit({
      payload: { side: "buy", price: 2450, stopLoss: 2400 },
      riskProfile: { riskRewardRatio: null },
    });
    assert.equal(result, null);
  });

  test("returns null when there's no risk profile at all", () => {
    const result = computeTakeProfit({
      payload: { side: "buy", price: 2450, stopLoss: 2400 },
      riskProfile: null,
    });
    assert.equal(result, null);
  });

  test("a zero ratio is treated as disabled, not a valid multiplier", () => {
    const result = computeTakeProfit({
      payload: { side: "buy", price: 2450, stopLoss: 2400 },
      riskProfile: { riskRewardRatio: 0 },
    });
    assert.equal(result, null);
  });

  test("explicit takeProfit of 0 is honored, not treated as falsy/missing", () => {
    // A degenerate case (nobody would set a real take-profit to 0), but the
    // check is `!== undefined && !== null`, not truthiness — worth locking
    // that in explicitly since a truthiness check would be a subtle bug.
    const result = computeTakeProfit({
      payload: { side: "buy", price: 2450, stopLoss: 2400, takeProfit: 0 },
      riskProfile: { riskRewardRatio: 2 },
    });
    assert.equal(result, 0);
  });
});
