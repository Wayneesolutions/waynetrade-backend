const axios = require("axios");

/**
 * Execution Bridge — MetaApi.cloud (MT4/MT5) integration.
 *
 * HONEST STATUS: this is a stub. It is NOT tested against a real
 * MetaApi account. Before Phase 1 goes live on even a demo account:
 *   1. Create a MetaApi.cloud account + get METAAPI_TOKEN
 *   2. Connect a demo MT5 account, get its accountId
 *   3. Replace the placeholder request below with the real MetaApi
 *      trade endpoint (see https://metaapi.cloud/docs/client/)
 *   4. Add retry/error handling for broker-side rejections
 *      (insufficient margin, market closed, symbol not found, etc.)
 *
 * Do NOT wire this to a funded live account until it has been run
 * against a demo account for at least the full Phase 1 test window.
 */

const METAAPI_BASE_URL = process.env.METAAPI_BASE_URL || "https://mt-client-api-v1.new-york.agiliumtrade.ai";
const METAAPI_TOKEN = process.env.METAAPI_TOKEN;

async function placeOrder({ metaApiAccountId, symbol, side, volume, stopLoss, takeProfit }) {
  if (!METAAPI_TOKEN) {
    throw new Error("METAAPI_TOKEN not configured — cannot place live/demo orders yet");
  }

  // Placeholder shape — confirm exact endpoint/payload against current
  // MetaApi docs before using; their trade API has changed across versions.
  const response = await axios.post(
    `${METAAPI_BASE_URL}/users/current/accounts/${metaApiAccountId}/trade`,
    {
      actionType: side === "buy" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
      symbol,
      volume,
      stopLoss,
      takeProfit,
    },
    {
      headers: {
        "auth-token": METAAPI_TOKEN,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data; // shape TBD — inspect against real API before relying on fields
}

module.exports = { placeOrder };
