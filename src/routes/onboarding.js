const express = require("express");
const crypto = require("crypto");
const prisma = require("../db/prisma");
const { encryptSecret } = require("../services/encryption");

const router = express.Router();

/**
 * Closes the "no onboarding UI" gap — these routes let the dashboard's
 * onboarding form create groups/members/strategies without anyone touching
 * the database directly. All behind the same admin API-key auth as the
 * rest of /dashboard and /kill-switch.
 */

router.post("/group", async (req, res, next) => {
  try {
    const { name, adminUserId } = req.body;
    if (!name || !adminUserId) {
      return res.status(400).json({ error: "name and adminUserId are required" });
    }
    const group = await prisma.group.create({ data: { name, adminUserId } });
    res.status(201).json(group);
  } catch (err) {
    next(err);
  }
});

router.post("/group/:groupId/member", async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { userId, brokerType, brokerAccountRef, riskProfile } = req.body;

    if (!userId || !brokerType || !brokerAccountRef) {
      return res.status(400).json({ error: "userId, brokerType, and brokerAccountRef are required" });
    }
    if (!["METATRADER", "KITE_CONNECT"].includes(brokerType)) {
      return res.status(400).json({ error: "brokerType must be METATRADER or KITE_CONNECT" });
    }

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: "Group not found" });

    // A member with no risk profile is deliberately allowed — the risk
    // engine correctly rejects signals for that member until one is set,
    // rather than silently guessing a position size.
    let riskProfileId = null;
    if (riskProfile && riskProfile.fixedLots !== undefined) {
      const created = await prisma.riskProfile.create({
        data: {
          fixedLots: riskProfile.fixedLots,
          maxDailyLossPercent: riskProfile.maxDailyLossPercent ?? null,
          maxOpenPositions: riskProfile.maxOpenPositions ?? null,
          // Omit to keep the schema default (2.0); pass null to disable
          // auto profit-booking entirely for this member.
          ...(riskProfile.riskRewardRatio !== undefined && { riskRewardRatio: riskProfile.riskRewardRatio }),
        },
      });
      riskProfileId = created.id;
    }

    const member = await prisma.member.create({
      data: {
        groupId,
        userId,
        brokerType,
        brokerAccountRef,
        riskProfileId,
      },
      include: { riskProfile: true },
    });

    res.status(201).json(member);
  } catch (err) {
    next(err);
  }
});

/**
 * Set or replace a member's risk profile after the fact (e.g. adjusting
 * position size for one person without recreating them).
 */
router.put("/member/:memberId/risk-profile", async (req, res, next) => {
  try {
    const { memberId } = req.params;
    const { fixedLots, maxDailyLossPercent, maxOpenPositions, riskRewardRatio } = req.body;

    if (fixedLots === undefined) {
      return res.status(400).json({ error: "fixedLots is required" });
    }

    const member = await prisma.member.findUnique({ where: { id: memberId } });
    if (!member) return res.status(404).json({ error: "Member not found" });

    // riskRewardRatio: undefined leaves the existing value alone on update
    // (or the schema default of 2.0 on create); pass null explicitly to
    // disable auto profit-booking for this member.
    const riskRewardRatioData =
      riskRewardRatio !== undefined ? { riskRewardRatio } : {};

    let riskProfile;
    if (member.riskProfileId) {
      riskProfile = await prisma.riskProfile.update({
        where: { id: member.riskProfileId },
        data: {
          fixedLots,
          maxDailyLossPercent: maxDailyLossPercent ?? null,
          maxOpenPositions: maxOpenPositions ?? null,
          ...riskRewardRatioData,
        },
      });
    } else {
      riskProfile = await prisma.riskProfile.create({
        data: {
          fixedLots,
          maxDailyLossPercent: maxDailyLossPercent ?? null,
          maxOpenPositions: maxOpenPositions ?? null,
          ...riskRewardRatioData,
        },
      });
      await prisma.member.update({ where: { id: memberId }, data: { riskProfileId: riskProfile.id } });
    }

    res.status(200).json(riskProfile);
  } catch (err) {
    next(err);
  }
});

/**
 * Creates a strategy and generates its webhook secret server-side — the
 * plaintext secret is returned exactly once in this response (to paste into
 * TradingView's alert config) and is never retrievable again afterwards;
 * only its encrypted form is stored.
 */
router.post("/group/:groupId/strategy", async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { name, sourceType } = req.body;

    if (!name || !["PINE_SCRIPT", "CUSTOM"].includes(sourceType)) {
      return res.status(400).json({ error: "name and sourceType (PINE_SCRIPT or CUSTOM) are required" });
    }

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: "Group not found" });

    const plaintextSecret = crypto.randomBytes(32).toString("hex");
    const webhookSecretEncrypted = encryptSecret(plaintextSecret);

    const strategy = await prisma.strategy.create({
      data: { groupId, name, sourceType, webhookSecretEncrypted },
    });

    res.status(201).json({
      strategy,
      webhookSecretPlaintext: plaintextSecret,
      webhookUrlPath: `/webhook/${strategy.id}`,
      warning: "Save this secret now — it will not be shown again. Put it in TradingView's alert webhook config to sign requests.",
    });
  } catch (err) {
    next(err);
  }
});

router.get("/groups", async (req, res, next) => {
  try {
    const groups = await prisma.group.findMany({
      include: { members: true, strategies: true },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json(groups);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
