const express = require("express");
const prisma = require("../db/prisma");
const { verifyWebhookSignature } = require("../middleware/verifyWebhookSignature");
const { evaluateSignalForMember } = require("../services/riskEngine");
const { placeOrder } = require("../services/metaApiBridge");

const router = express.Router();

async function getSecretHashForStrategy(strategyId) {
  // NOTE: we store a hash, not the plaintext secret. The signature check
  // in verifyWebhookSignature currently compares against the raw secret —
  // before going live, switch strategies.webhookSecretHash to store the
  // ACTUAL secret in an env-var/secrets-manager reference, and verify
  // against that, not the hash. Flagging this now so it isn't missed:
  // hashing the secret and then trying to HMAC-verify against the hash
  // does not work — you need the original secret for HMAC.
  const strategy = await prisma.strategy.findUnique({ where: { id: strategyId } });
  return strategy ? process.env[`STRATEGY_SECRET_${strategyId}`] : null;
}

router.post(
  "/:strategyId",
  verifyWebhookSignature(getSecretHashForStrategy),
  async (req, res, next) => {
    try {
      const { strategyId } = req.params;

      const strategy = await prisma.strategy.findUnique({
        where: { id: strategyId },
        include: { group: { include: { members: true } } },
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

        const decision = await evaluateSignalForMember(signal, member, {
          // TODO: load real per-member risk profile once that table/config exists
          riskProfile: { fixedLots: 0.01 },
        });

        let order = null;
        if (decision.action === "APPROVE" && member.brokerType === "METATRADER") {
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
            const brokerResult = await placeOrder({
              metaApiAccountId: member.brokerAccountRef,
              symbol: req.body.symbol,
              side: req.body.side,
              volume: decision.positionSize,
              stopLoss: req.body.stopLoss,
              takeProfit: req.body.takeProfit,
            });
            order = await prisma.order.update({
              where: { id: order.id },
              data: { status: "SENT", brokerOrderRef: brokerResult?.orderId ?? null },
            });
          } catch (err) {
            order = await prisma.order.update({
              where: { id: order.id },
              data: { status: "ERROR" },
            });
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
