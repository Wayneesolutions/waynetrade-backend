// KITE_API_KEY is read into a module-level constant at require time, so it
// must be set BEFORE requiring the module — this is why these tests live
// in their own file rather than sharing one with metaApiBridge.test.js.
process.env.KITE_API_KEY = "test-kite-api-key";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { placeOrder, placeProtectiveExit } = require("../src/services/kiteConnectBridge");

/**
 * These only cover the pre-flight validation — every case here throws
 * before the first network call, so no real Kite Connect account or
 * network access is needed. That validation is exactly what stands
 * between "an equities order" and "an untagged/unprotected equities
 * order", which is the actual point of this bridge's design.
 */
describe("kiteConnectBridge.placeOrder validation", () => {
  test("rejects with no accessToken, before ever building a request", async () => {
    await assert.rejects(
      () => placeOrder({ exchange: "NSE", tradingSymbol: "RELIANCE", side: "buy", quantity: 10, algoId: "ALGO1" }),
      /no valid Kite access token/i
    );
  });

  test("refuses to place an equities order with no Algo-ID — this is the SEBI requirement, not optional", async () => {
    await assert.rejects(
      () =>
        placeOrder({
          accessToken: "some-token",
          exchange: "NSE",
          tradingSymbol: "RELIANCE",
          side: "buy",
          quantity: 10,
          // algoId omitted
        }),
      /No Algo-ID on this strategy/
    );
  });
});

describe("kiteConnectBridge.placeProtectiveExit validation", () => {
  test("refuses to leave a position unprotected — rejects with no stopLoss", async () => {
    await assert.rejects(
      () =>
        placeProtectiveExit({
          accessToken: "some-token",
          exchange: "NSE",
          tradingSymbol: "RELIANCE",
          entrySide: "buy",
          quantity: 10,
          lastPrice: 2450,
          // stopLoss omitted
        }),
      /refusing to leave an equities position unprotected/
    );
  });

  test("rejects with no lastPrice — GTT can't validate trigger levels without one", async () => {
    await assert.rejects(
      () =>
        placeProtectiveExit({
          accessToken: "some-token",
          exchange: "NSE",
          tradingSymbol: "RELIANCE",
          entrySide: "buy",
          quantity: 10,
          stopLoss: 2400,
          // lastPrice omitted
        }),
      /No reference price/
    );
  });
});
