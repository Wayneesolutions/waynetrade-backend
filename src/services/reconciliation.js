const prisma = require("../db/prisma");
const { placeProtectiveExit } = require("./kiteConnectBridge");

/**
 * Closes the real risk window created by Kite entry + protective GTT being
 * two separate broker requests (see kiteConnectBridge.js's header comment,
 * gap #2): if the GTT call failed after a successful entry, the position
 * sits open and unprotected until someone acts. This finds every such
 * order and retries the GTT placement.
 *
 * Meant to be triggered periodically by an external cron hitting
 * POST /ops/retry-unprotected-orders — same pattern as /research/scan and
 * saaf-signal-backend's scheduler.py hitting /check-outcomes. No
 * in-process scheduler here, for the same reason none exists for those:
 * deploy platforms differ too much to bake one in.
 */
async function retryUnprotectedOrders() {
  const orders = await prisma.order.findMany({
    where: {
      status: "SENT",
      protectiveTriggerRef: null,
      member: { brokerType: "KITE_CONNECT" },
    },
    include: {
      member: true,
      riskDecision: { include: { signal: true } },
    },
  });

  const results = [];
  for (const order of orders) {
    const payload = order.riskDecision.signal.rawPayload;
    try {
      const protective = await placeProtectiveExit({
        accessToken: order.member.brokerAccountRef,
        exchange: payload.exchange || "NSE",
        tradingSymbol: payload.symbol,
        entrySide: payload.side,
        quantity: order.riskDecision.positionSize,
        product: payload.product,
        stopLoss: payload.stopLoss,
        takeProfit: order.riskDecision.takeProfit,
        lastPrice: payload.price,
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { protectiveTriggerRef: protective.triggerId },
      });
      results.push({ orderId: order.id, status: "now_protected" });
    } catch (err) {
      // Still unprotected — logged, not thrown, so one stubborn order
      // doesn't stop the rest of the batch from being retried.
      console.error(`Reconciliation: order ${order.id} still unprotected:`, err.message);
      results.push({ orderId: order.id, status: "still_unprotected", error: err.message });
    }
  }

  return results;
}

module.exports = { retryUnprotectedOrders };
