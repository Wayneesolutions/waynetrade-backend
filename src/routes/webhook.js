const express = require("express");
const prisma = require("../db/prisma");
const { verifyWebhookSignature } = require("../middleware/verifyWebhookSignature");
const { evaluateSignalForMember } = require("../services/riskEngine");
const { placeOrder: placeMetaTraderOrder } = require("../services/metaApiBridge");
const { placeOrder: placeKiteOrder } = require("../services/kiteConnectBridge");
const { decryptSecret } = require("../services/encryption");
const { notifyInvestorOfOrder } = require("../services/notificationService");

/**
 * One broker call per supported brokerType, normalized to
 * { filled, brokerOrderRef, algoId }. "filled" here means "the broker
 * accepted/executed it", matching each bridge's own honest gaps (MetaApi's
 * stringCode check is a real fill confirmation; Kite's is not — Kite only
 * confirms the order was queued, per kiteConnectBridge.js's own gap #2).
 */
const brokerExecutors = {
  async METATRADER({ member, decision, payload, orderId }) {
    const brokerResult = await placeMetaTraderOrder({
      metaApiAccountId: member.brokerAccountRef,
      symbol: payload.symbol,
      side: payload.side,
      volume: decision.positionSize,
      stopLoss: payload.stopLoss,
      // Risk engine already resolved this: signal's own explicit takeProfit
      // if given, else auto-computed from the member's riskRewardRatio,
      // else null — never re-read the raw payload here, or auto
      // profit-booking silently loses to nothing.
      takeProfit: decision.takeProfit,
      clientId: orderId,
    });
    // MetaApi returns 200 even for some broker-side rejections —
    // stringCode !== TRADE_RETCODE_DONE means it did NOT fill.
    return {
      filled: brokerResult?.stringCode === "TRADE_RETCODE_DONE",
      brokerOrderRef: brokerResult?.orderId ?? null,
      algoId: null,
    };
  },

  async KITE_CONNECT({ member, decision, payload, orderId, strategy }) {
    const result = await placeKiteOrder({
      accessToken: member.brokerAccountRef,
      exchange: payload.exchange || "NSE",
      tradingSymbol: payload.symbol,
      side: payload.side,
      quantity: decision.positionSize,
      product: payload.product,
      algoId: strategy.algoId,
      clientId: orderId,
    });
    // Kite's response only confirms the order was accepted into the
    // exchange queue, not that it filled — no synchronous fill confirmation
    // the way MetaApi's stringCode gives us. Treated as "SENT" here, same
    // convention as MetaApi's filled=true case; a real fill-status pipeline
    // needs Kite's order-update websocket, not built yet.
    return { filled: true, brokerOrderRef: result.orderId, algoId: result.algoId };
  },
};

const router = express.Router();

async function getSecretForStrategy(strategyId) {
  // Fixed gap: strategies.webhookSecretEncrypted stores an AES-256-GCM
  // ciphertext (not a one-way hash), so we can decrypt it back to the
  // original secret here for HMAC comparison. See src/services/encryption.js.
  const strategy = await prisma.strategy.findUnique({ where: { id: strategyId } });
  if (!strategy) return null;
  try {
    return decryptSecret(strategy.webhookSecretEncrypted);
  } catch (err) {
    console.error(`Failed to decrypt webhook secret for strategy ${strategyId}:`, err.message);
    return null;
  }
}

router.post(
  "/:strategyId",
  verifyWebhookSignature(getSecretForStrategy),
  async (req, res, next) => {
    try {
      const { strategyId } = req.params;

      const strategy = await prisma.strategy.findUnique({
        where: { id: strategyId },
        include: { group: { include: { members: { include: { riskProfile: true } } } } },
      });

      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }

      // 1. Log the raw signal immediately — immutable record, before any decisioning.
      const signal = await prisma.signal.create({
        data: {
          strategyId,
          rawPayload: req.body,
          validated: true,
        },
      });

      // 2. Run the risk engine per member in the group.
      const results = [];
      for (const member of strategy.group.members) {
        if (member.status === "REMOVED") continue;

        // member.riskProfile is null if the group admin hasn't set one up yet
        // for this person — the risk engine correctly rejects in that case
        // rather than silently falling back to a guessed size.
        const decision = await evaluateSignalForMember(signal, member, {
          riskProfile: member.riskProfile
            ? {
                fixedLots: Number(member.riskProfile.fixedLots),
                riskRewardRatio:
                  member.riskProfile.riskRewardRatio !== null
                    ? Number(member.riskProfile.riskRewardRatio)
                    : null,
              }
            : null,
        });

        let order = null;
        const executor = brokerExecutors[member.brokerType];
        if (decision.action === "APPROVE" && executor) {
          order = await prisma.order.create({
            data: {
              riskDecisionId: decision.id,
              memberId: member.id,
              status: "PENDING",
            },
          });

          // Fire-and-log the execution attempt. Failures here must NOT
          // silently disappear — they go to order.status = ERROR.
          try {
            const { filled, brokerOrderRef, algoId } = await executor({
              member,
              decision,
              payload: req.body,
              orderId: order.id,
              strategy,
            });
            order = await prisma.order.update({
              where: { id: order.id },
              data: {
                status: filled ? "SENT" : "REJECTED",
                brokerOrderRef,
                algoId,
              },
            });
          } catch (err) {
            order = await prisma.order.update({
              where: { id: order.id },
              data: { status: "ERROR" },
            });
          }

          // Layer 3 — real-time transparency: tell the investor what just
          // happened in their account, win or loss, filled or not. Must
          // never take down the webhook response if it fails — the trade
          // itself already happened, losing the notification is a lesser
          // failure than losing the 200 response TradingView expects.
          try {
            await notifyInvestorOfOrder({
              order,
              member,
              decision,
              signal,
              strategyName: strategy.name,
            });
          } catch (err) {
            console.error(`Investor notification failed for order ${order.id}:`, err.message);
          }
        }

        results.push({ memberId: member.id, decision: decision.action, orderId: order?.id ?? null });
      }

      res.status(200).json({ signalId: signal.id, results });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
