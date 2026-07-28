const express = require("express");
const prisma = require("../db/prisma");
const { verifyWebhookSignature } = require("../middleware/verifyWebhookSignature");
const { evaluateSignalForMember } = require("../services/riskEngine");
const metaApiBridge = require("../services/metaApiBridge");
const kiteBridge = require("../services/kiteBridge");
const { decryptSecret } = require("../services/encryption");
const notifications = require("../services/notifications");

const router = express.Router();

async function getSecretForStrategy(strategyId) {
  // Fixed gap: strategies.webhookSecretEncrypted stores an AES-256-GCM
  // ciphertext (not a one-way hash), so we can decrypt it back to the
  // original secret here for HMAC comparison. See src/services/encryption.js.
  const strategy = await prisma.strategy.findUnique({ where: { id: strategyId } });
  if (!strategy || strategy.archived) return null; // archived = webhook off
  try {
    return decryptSecret(strategy.webhookSecretEncrypted);
  } catch (err) {
    console.error(`Failed to decrypt webhook secret for strategy ${strategyId}:`, err.message);
    return null;
  }
}

/**
 * Executes an approved decision on the member's own broker account.
 * Returns the final order row. Failures never escape: they land in
 * order.status = ERROR and a notification, per "no silent failures".
 */
async function executeDecision({ decision, member, payload }) {
  let order = await prisma.order.create({
    data: {
      riskDecisionId: decision.id,
      memberId: member.id,
      status: "PENDING",
    },
  });

  try {
    if (member.brokerType === "METATRADER") {
      const brokerResult = await metaApiBridge.placeOrder({
        metaApiAccountId: member.brokerAccountRef,
        symbol: payload.symbol,
        side: payload.side,
        volume: decision.positionSize,
        stopLoss: payload.stopLoss,
        takeProfit: payload.takeProfit,
        clientId: order.id,
      });

      // MetaApi returns 200 even for some broker-side rejections —
      // stringCode !== TRADE_RETCODE_DONE means it did NOT fill.
      const filled = brokerResult?.stringCode === "TRADE_RETCODE_DONE";
      order = await prisma.order.update({
        where: { id: order.id },
        data: {
          status: filled ? "SENT" : "REJECTED",
          brokerOrderRef: brokerResult?.orderId ?? null,
        },
      });
    } else if (member.brokerType === "KITE_CONNECT") {
      // Phase 3 path — gated behind KITE_ENABLED, tags every order with the
      // SEBI Algo-ID. NOTE: the risk engine's hard stop-loss is enforced on
      // the signal, but Kite market orders carry no stop parameter — a real
      // equities go-live needs a paired SL order placed here too.
      const brokerResult = await kiteBridge.placeOrder({
        symbol: payload.symbol,
        side: payload.side,
        quantity: decision.positionSize,
        clientOrderId: order.id,
      });
      order = await prisma.order.update({
        where: { id: order.id },
        data: {
          status: "SENT",
          brokerOrderRef: brokerResult.orderId,
          algoId: brokerResult.algoId,
        },
      });
    } else {
      throw new Error(`Unknown brokerType ${member.brokerType}`);
    }
  } catch (err) {
    order = await prisma.order.update({
      where: { id: order.id },
      data: { status: "ERROR" },
    });
    notifications.notifyOrderError({
      memberLabel: member.userId,
      symbol: payload.symbol,
      detail: err.message,
    });
  }

  return order;
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

      if (!strategy || strategy.archived) {
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
            ? { fixedLots: Number(member.riskProfile.fixedLots) }
            : null,
        });

        let order = null;
        if (decision.action === "APPROVE") {
          order = await executeDecision({ decision, member, payload: req.body });
        }

        results.push({
          memberId: member.id,
          memberLabel: member.userId,
          decision: decision.action,
          reason: decision.reason,
          orderId: order?.id ?? null,
          orderStatus: order?.status ?? null,
        });
      }

      // 3. Tell the group what happened — fire-and-forget, never blocks the response.
      notifications.notifySignalProcessed({
        strategyName: strategy.name,
        symbol: req.body.symbol,
        side: req.body.side,
        results,
      });

      res.status(200).json({
        signalId: signal.id,
        results: results.map(({ memberId, decision, orderId }) => ({ memberId, decision, orderId })),
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
