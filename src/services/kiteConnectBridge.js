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
 *   2. Stop-loss/take-profit ARE now sent, via placeProtectiveExit()'s GTT
 *      call right after entry (Kite has no single "order + SL/TP" call the
 *      way MetaApi does) — but this is two separate broker requests, not
 *      one atomic operation. If the entry order succeeds and the GTT call
 *      then fails (network error, Kite rejects the trigger levels as too
 *      far from last_price, member's Kite account has GTT disabled, etc.),
 *      the position IS OPEN AND UNPROTECTED — the entry cannot be undone by
 *      this function. Callers MUST treat that combination as urgent, not
 *      swallow the error (see webhook.js's KITE_CONNECT executor, which
 *      surfaces it in the investor notification).
 *   3. placeProtectiveExit()'s GTT trigger validates against a `lastPrice`
 *      that callers pass in from the signal's own reference price — not a
 *      live quote fetched at GTT-creation time. Kite rejects GTT triggers
 *      too far from the real LTP; a stale reference price on a fast-moving
 *      stock can cause exactly that rejection (case above).
 *   4. No retry/backoff for broker-side rejections (insufficient margin,
 *      market closed, invalid tradingsymbol) — errors are surfaced as
 *      thrown exceptions, same convention as metaApiBridge.js.
 *
 * Do NOT wire this to a funded live account until gaps #2/#3 have been
 * exercised against a real account — an equities order with a GTT that
 * silently failed to place is exactly the failure mode the rest of this
 * codebase exists to prevent.
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

/**
 * Places a protective GTT (Good Till Triggered) order covering the entry's
 * stop-loss and (if computed) take-profit — this is what actually closes
 * gap #2 above. Two-leg GTT (OCO — whichever trigger fires first cancels
 * the other) when both levels exist; single-leg (stop-loss only) when
 * takeProfit is unavailable, since a two-leg GTT needs two trigger values.
 *
 * MUST be called right after placeOrder()'s entry succeeds. If this throws,
 * the entry order has ALREADY been placed — the caller is responsible for
 * treating "entry placed, protection failed" as urgent, not for retrying
 * this blindly (see gap #2/#3 in this file's header).
 */
async function placeProtectiveExit({
  accessToken,
  exchange,
  tradingSymbol,
  entrySide, // "buy" | "sell" — the entry's side; the exit leg(s) are the opposite
  quantity,
  product,
  stopLoss,
  takeProfit,
  lastPrice,
}) {
  if (!KITE_API_KEY) {
    throw new Error("KITE_API_KEY not configured — cannot place protective exit yet");
  }
  if (!accessToken) {
    throw new Error("Member has no valid Kite access token configured");
  }
  if (!stopLoss) {
    throw new Error("No stopLoss given — refusing to leave an equities position unprotected");
  }
  if (!lastPrice) {
    throw new Error(
      "No reference price (signal's payload.price) given — GTT requires a last_price to validate trigger levels against"
    );
  }

  const exitTransactionType = entrySide === "buy" ? "SELL" : "BUY";
  const exitLeg = (triggerPrice) => ({
    exchange,
    tradingsymbol: tradingSymbol,
    transaction_type: exitTransactionType,
    quantity: Number(quantity),
    order_type: "LIMIT",
    product: product || "MIS",
    price: triggerPrice,
  });

  const hasTakeProfit = takeProfit !== undefined && takeProfit !== null;
  const triggerValues = hasTakeProfit ? [Number(stopLoss), Number(takeProfit)] : [Number(stopLoss)];
  const orders = hasTakeProfit
    ? [exitLeg(Number(stopLoss)), exitLeg(Number(takeProfit))]
    : [exitLeg(Number(stopLoss))];

  const body = new URLSearchParams({
    condition: JSON.stringify({
      exchange,
      tradingsymbol: tradingSymbol,
      trigger_values: triggerValues,
      last_price: Number(lastPrice),
    }),
    orders: JSON.stringify(orders),
    type: hasTakeProfit ? "two-leg" : "single",
  });

  try {
    const response = await axios.post(`${KITE_BASE_URL}/gtt/triggers`, body, {
      headers: {
        Authorization: `token ${KITE_API_KEY}:${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Kite-Version": "3",
      },
      timeout: 15000,
    });
    return { triggerId: response.data?.data?.trigger_id };
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const data = err.response.data;
      throw new Error(
        `Kite GTT request failed (${status}): ${data?.message || JSON.stringify(data)}`
      );
    }
    throw err;
  }
}

module.exports = { placeOrder, placeProtectiveExit };
