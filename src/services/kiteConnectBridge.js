const axios = require("axios");

/**
 * Execution Bridge — Kite Connect (Zerodha) integration for Indian equities.
 *
 * Endpoint: POST https://api.kite.trade/orders/:variety, form-urlencoded
 * (NOT JSON — this is a real Kite Connect quirk, unlike MetaApi), header
 * `Authorization: token <api_key>:<access_token>`, per Kite Connect's
 * published REST docs (kite.trade/docs/connect/v3/orders/).
 *
 * HONEST GAPS — this has NOT been run against a real Kite Connect account:
 *   1. Per-member access token provisioning (Kite's login-flow + request-
 *      token exchange to obtain an access_token) is not implemented here —
 *      that's a one-time-per-day setup step (Kite access tokens expire at
 *      the start of every trading day; there is no long-lived refresh
 *      token), done via Kite's login flow before this bridge can be used
 *      for a given member. member.brokerAccountRef is expected to already
 *      resolve to a currently-valid access token in the secrets manager.
 *   2. Stop-loss and take-profit are NOT part of the same order request the
 *      way they are with MetaApi — Kite Connect has no single "place order
 *      with SL/TP attached" call. Doing this properly needs either a
 *      separate SL-M order or a GTT (Good Till Triggered) order placed
 *      right after the entry fills. NOT implemented in this pass — the risk
 *      engine's computed stopLoss/takeProfit are accepted by this function's
 *      signature but not yet sent anywhere. Do not treat an equities order
 *      placed through this bridge as protected until that follow-up order
 *      is built.
 *   3. No retry/backoff for broker-side rejections (insufficient margin,
 *      market closed, invalid tradingsymbol) — errors are surfaced as
 *      thrown exceptions, same convention as metaApiBridge.js.
 *
 * Do NOT wire this to a funded live account until gap #2 (SL/TP
 * enforcement) is closed — an equities order with no working stop-loss is
 * exactly the failure mode the rest of this codebase exists to prevent.
 */

const KITE_BASE_URL = "https://api.kite.trade";
const KITE_API_KEY = process.env.KITE_API_KEY;

/**
 * Places a market order per Kite Connect's regular order variety.
 * side: "buy" | "sell" (mapped to BUY/SELL)
 * algoId is required — SEBI's retail algo-trading framework requires every
 * algorithmic order to carry the exchange-assigned Algo-ID; there is no
 * legally-correct way to place an untagged algo order for equities, so the
 * caller must resolve this from strategy.algoId before calling here.
 */
async function placeOrder({
  accessToken,
  exchange,
  tradingSymbol,
  side,
  quantity,
  product,
  algoId,
  clientId,
}) {
  if (!KITE_API_KEY) {
    throw new Error("KITE_API_KEY not configured — cannot place live orders yet");
  }
  if (!accessToken) {
    throw new Error("Member has no valid Kite access token (members.broker_account_ref) configured");
  }
  if (!algoId) {
    throw new Error(
      "No Algo-ID on this strategy — SEBI requires every algo order to carry one, refusing to place an untagged equities order"
    );
  }

  const body = new URLSearchParams({
    exchange,
    tradingsymbol: tradingSymbol,
    transaction_type: side === "buy" ? "BUY" : "SELL",
    quantity: String(quantity),
    product: product || "MIS", // MIS = intraday; CNC for delivery, caller's choice per strategy
    order_type: "MARKET",
    validity: "DAY",
    // Kite's tag field, max 20 alphanumeric chars — carries our own order id
    // for reconciliation, same purpose as MetaApi's clientId.
    ...(clientId && { tag: String(clientId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 20) }),
  });

  try {
    const response = await axios.post(`${KITE_BASE_URL}/orders/regular`, body, {
      headers: {
        Authorization: `token ${KITE_API_KEY}:${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Kite-Version": "3",
      },
      timeout: 15000,
    });

    // Success shape per docs: { status: "success", data: { order_id } }.
    // HTTP 200 here means Kite ACCEPTED the order into the queue, not that
    // it filled — same "don't assume 200 = filled" rule as the MetaApi
    // bridge, though Kite's async order-update webhook (not implemented
    // here) is the only way to know the real fill status.
    return { orderId: response.data?.data?.order_id, algoId };
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const data = err.response.data;
      throw new Error(
        `Kite Connect order request failed (${status}): ${data?.message || JSON.stringify(data)}`
      );
    }
    throw err;
  }
}

module.exports = { placeOrder };
