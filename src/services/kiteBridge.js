const axios = require("axios");

/**
 * Execution Bridge — Kite Connect (Zerodha) for Indian equities/F&O.
 * Phase 3 path from the build guide, wired but NOT production-ready.
 *
 * Built against Kite Connect v3's published REST docs
 * (kite.trade/docs/connect/v3/orders/):
 *   POST https://api.kite.trade/orders/regular
 *   Header: Authorization: token <api_key>:<access_token>
 *   Content-Type: application/x-www-form-urlencoded
 *
 * HONEST GAPS — read before going anywhere near real equities trading:
 *   1. ACCESS TOKEN FLOW IS MANUAL AND DAILY. Kite access tokens expire
 *      every day and can only be minted through an interactive user login
 *      (login URL → request_token → session exchange). There is no
 *      headless renewal by design (SEBI requirement). Someone must refresh
 *      KITE_ACCESS_TOKEN daily, or you build the login handoff into the
 *      dashboard — not done here.
 *   2. ALGO-ID / EXCHANGE ALGO TAGGING. SEBI's 2026 framework requires
 *      registered algo identifiers on algo orders. The `tag` field below
 *      carries our KITE_ALGO_ID as a first step, but the real registration
 *      process (broker-side algo registration, exchange approval) MUST be
 *      confirmed with the broker directly — the guide is explicit that this
 *      cannot be assumed from documentation.
 *   3. NEVER TESTED against a real Kite account. Zero real API calls made.
 *   4. Lot-size/quantity mapping is naive: `volume` from the risk engine is
 *      used as `quantity` directly. Equities/F&O quantities are integers
 *      with instrument-specific lot sizes — a real implementation needs an
 *      instrument master lookup.
 *   5. Legal/compliance review (guide Section 6) has not happened. Do not
 *      enable this path with real money before it does.
 *
 * The whole path is additionally gated behind KITE_ENABLED=true so nobody
 * trips into live equities orders by merely configuring credentials.
 */

const KITE_BASE_URL = process.env.KITE_BASE_URL || "https://api.kite.trade";
const KITE_API_KEY = process.env.KITE_API_KEY;
const KITE_ACCESS_TOKEN = process.env.KITE_ACCESS_TOKEN;
const KITE_ALGO_ID = process.env.KITE_ALGO_ID;
const KITE_ENABLED = process.env.KITE_ENABLED === "true";

/**
 * Places a market order on NSE via Kite Connect.
 * Returns { orderId, algoId } on success.
 */
async function placeOrder({ symbol, side, quantity, clientOrderId }) {
  if (!KITE_ENABLED) {
    throw new Error(
      "Kite Connect path is disabled (set KITE_ENABLED=true only after broker Algo-ID registration and compliance review)"
    );
  }
  if (!KITE_API_KEY || !KITE_ACCESS_TOKEN) {
    throw new Error("KITE_API_KEY / KITE_ACCESS_TOKEN not configured (access token must be refreshed daily)");
  }
  if (!KITE_ALGO_ID) {
    // Fail closed: an equities algo order without its Algo-ID tag is exactly
    // the compliance failure the audit trail exists to prevent.
    throw new Error("KITE_ALGO_ID not configured — refusing to place an untagged algo order");
  }

  const params = new URLSearchParams({
    exchange: "NSE",
    tradingsymbol: symbol,
    transaction_type: side === "buy" ? "BUY" : "SELL",
    order_type: "MARKET",
    quantity: String(Math.max(1, Math.round(Number(quantity)))),
    product: "MIS",
    validity: "DAY",
    // Kite's `tag` (max 20 chars) is echoed back on the order — we use it to
    // carry the Algo-ID so every order is traceable, per the guide's
    // audit/compliance requirement. Confirm with the broker whether their
    // Algo-ID mechanism uses `tag` or a dedicated field before go-live.
    tag: String(KITE_ALGO_ID).slice(0, 20),
  });

  try {
    const response = await axios.post(`${KITE_BASE_URL}/orders/regular`, params.toString(), {
      headers: {
        Authorization: `token ${KITE_API_KEY}:${KITE_ACCESS_TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Kite-Version": "3",
      },
      timeout: 15000,
    });
    // Success shape per docs: { status: "success", data: { order_id } }
    return { orderId: response.data?.data?.order_id ?? null, algoId: KITE_ALGO_ID, clientOrderId };
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const data = err.response.data;
      throw new Error(`Kite order failed (${status}): ${data?.message || JSON.stringify(data)}`);
    }
    throw err;
  }
}

module.exports = { placeOrder, KITE_ENABLED };
