const express = require("express");
const prisma = require("../db/prisma");
const { verifyWebhookSignature } = require("../middleware/verifyWebhookSignature");
const { evaluateSignalForMember } = require("../services/riskEngine");
const { placeOrder: placeMetaTraderOrder } = require("../services/metaApiBridge");
const { placeOrder: placeKiteOrder, placeProtectiveExit } = require("../services/kiteConnectBridge");
const { decryptSecret } = require("../services/encryption");
const { notifyInvestorOfOrder } = require("../services/notificationService");

/**
 * One broker call per supported brokerType, normalized to
 * { filled, brokerOrderRef, algoId, protectiveTriggerRef, protectionWarning }.
 * "filled" here means "the broker accepted/executed it", matching each
 * bridge's own honest gaps (MetaApi's stringCode check is a real fill
 * confirmation; Kite's is not — Kite only confirms the order was queued).
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
    // stringCode !== TRADE_RETCODE_DONE means it did NOT fill. Stop-loss/
    // take-profit are attached to this same request and enforced by the
    // broker directly — no separate protective step needed here, unlike Kite.
    return {
      filled: brokerResult?.stringCode === "TRADE_RETCODE_DONE",
      brokerOrderRef: brokerResult?.orderId ?? null,
      algoId: null,
      protectiveTriggerRef: null,
      protectionWarning: null,
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

    // Entry is placed. Kite has no single "order + SL/TP" call — protection
    // is a SEPARATE request (GTT) that can fail independently of the entry
    // that already succeeded above. A failure here must never be silent:
    // the position is open and unprotected until a human/broker acts.
    let protectiveTriggerRef = null;
    let protectionWarning = null;
    try {
      const protective = await placeProtectiveExit({
        accessToken: member.brokerAccountRef,
        exchange: payload.exchange || "NSE",
        tradingSymbol: payload.symbol,
        entrySide: payload.side,
        quantity: decision.positionSize,
        product: payload.product,
        stopLoss: payload.stopLoss,
        takeProfit: decision.takeProfit,
        lastPrice: payload.price,
      });
      protectiveTriggerRef = protective.triggerId;
    } catch (err) {
      protectionWarning = `Stop-loss/take-profit protection FAILED to place (${err.message}) — this position is currently unprotected.`;
      console.error(`Kite protective GTT failed for order ${orderId} (entry already placed):`, err.message);
    }

    // Kite's response only confirms the order was accepted into the
    // exchange queue, not that it filled — no synchronous fill confirmation
    // the way MetaApi's stringCode gives us. Treated as "SENT" here, same
    // convention as MetaApi's filled=true case; a real fill-status pipeline
    // needs Kite's order-update websocket, not built yet.
    return {
      filled: true,
      brokerOrderRef: result.orderId,
      algoId: result.algoId,
      protectiveTriggerRef,
      protectionWarning,
    };
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
          let protectionWarning = null;
          try {
            const { filled, brokerOrderRef, algoId, protectiveTriggerRef, protectionWarning: warning } =
              await executor({
                member,
                decision,
                payload: req.body,
                orderId: order.id,
                strategy,
              });
            protectionWarning = warning;
            order = await prisma.order.update({
              where: { id: order.id },
              data: {
                status: filled ? "SENT" : "REJECTED",
                brokerOrderRef,
                algoId,
                protectiveTriggerRef,
              },
            });
          } catch (err) {
            order = await prisma.order.update({
              where: { id: order.id },
              data: { status: "ERROR" },
            });
          }

          // Layer 3 — real-time transparency: tell the investor what just
          // happened in their account, win or loss, filled or not — and if
          // an equities position's protective stop/target failed to place,
          // that goes in THIS message too, not just a server log. Must
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
              protectionWarning,
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
