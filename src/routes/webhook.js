const express = require("express");
const prisma = require("../db/prisma");
const { verifyWebhookSignature } = require("../middleware/verifyWebhookSignature");
const { evaluateSignalForMember } = require("../services/riskEngine");
const { placeOrder } = require("../services/metaApiBridge");
const { decryptSecret } = require("../services/encryption");

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
            ? { fixedLots: Number(member.riskProfile.fixedLots) }
            : null,
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
