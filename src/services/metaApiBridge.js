const axios = require("axios");

/**
 * Execution Bridge — MetaApi.cloud (MT4/MT5) integration.
 *
 * UPDATED: request/response shape below is now taken directly from MetaApi's
 * published REST API docs (metaapi.cloud/docs/client/restApi/api/trade/),
 * not a guess. Endpoint: POST /users/current/accounts/:accountId/trade,
 * header auth-token: <METAAPI_TOKEN>, body per the MetatraderTrade model.
 *
 * STILL HONEST GAPS — this has NOT been run against a real MetaApi account:
 *   1. Region routing: MetaApi's client API base URL is region-specific
 *      (new-york, london, etc. — find yours on MetaApi's "API access" page
 *      after creating an account). METAAPI_BASE_URL below defaults to
 *      new-york; change it if your account is provisioned elsewhere.
 *   2. Account provisioning (creating the MetaApi account entity itself,
 *      connecting a real MT5 login/password/server) is not implemented here
 *      — that's a one-time setup step per member, done via MetaApi's
 *      provisioning API or web dashboard before this bridge can be used.
 *   3. No retry/backoff for broker-side rejections (insufficient margin,
 *      market closed, requote, symbol not found) — errors are surfaced as
 *      thrown exceptions and the caller marks the order ERROR. Acceptable
 *      for a demo-account test run; not acceptable before real capital.
 *
 * Do NOT wire this to a funded live account until it has been run against a
 * demo account for the full Phase 1 test window.
 */

const METAAPI_BASE_URL =
  process.env.METAAPI_BASE_URL || "https://mt-client-api-v1.new-york.agiliumtrade.ai";
const METAAPI_TOKEN = process.env.METAAPI_TOKEN;

/**
 * Places a market order per the MetaApi MetatraderTrade "market order" schema.
 * side: "buy" | "sell"
 * stopLoss is required upstream by the risk engine (hard stop-loss rule),
 * so we always send it; takeProfit is optional.
 */
async function placeOrder({ metaApiAccountId, symbol, side, volume, stopLoss, takeProfit, clientId }) {
  if (!METAAPI_TOKEN) {
    throw new Error("METAAPI_TOKEN not configured — cannot place live/demo orders yet");
  }
  if (!metaApiAccountId) {
    throw new Error("Member has no metaApiAccountId (members.broker_account_ref) configured");
  }

  const body = {
    actionType: side === "buy" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
    symbol,
    volume,
  };
  if (stopLoss !== undefined && stopLoss !== null) body.stopLoss = stopLoss;
  if (takeProfit !== undefined && takeProfit !== null) body.takeProfit = takeProfit;
  // clientId lets us tie a MetaApi order back to our own orders.id for
  // reconciliation later (max combined length with comment is 26 chars,
  // per MetaApi's docs — keep this short).
  if (clientId) body.clientId = String(clientId).slice(0, 26);

  try {
    const response = await axios.post(
      `${METAAPI_BASE_URL}/users/current/accounts/${metaApiAccountId}/trade`,
      body,
      {
        headers: {
          "auth-token": METAAPI_TOKEN,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 15000,
      }
    );

    // Success shape per docs: { numericCode, stringCode, message, orderId }
    // stringCode "TRADE_RETCODE_DONE" = accepted by the trading terminal.
    // Any other stringCode is a broker-side rejection, not an HTTP error —
    // callers should check this, not just assume 200 means filled.
    return response.data;
  } catch (err) {
    if (err.response) {
      // MetaApi's documented error shapes: 400 invalid payload, 401 bad
      // token, 404 account not found/not provisioned yet.
      const status = err.response.status;
      const data = err.response.data;
      throw new Error(
        `MetaApi trade request failed (${status}): ${data?.message || JSON.stringify(data)}`
      );
    }
    throw err;
  }
}

module.exports = { placeOrder };
