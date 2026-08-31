// METAAPI_TOKEN is read into a module-level constant at require time, so it
// must be set BEFORE requiring the module.
process.env.METAAPI_TOKEN = "test-metaapi-token";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { placeOrder } = require("../src/services/metaApiBridge");

describe("metaApiBridge.placeOrder validation", () => {
  test("rejects with no metaApiAccountId, before ever building a request", async () => {
    await assert.rejects(
      () => placeOrder({ symbol: "EURUSD", side: "buy", volume: 0.01, stopLoss: 1.05 }),
      /Member has no metaApiAccountId/
    );
  });
});
