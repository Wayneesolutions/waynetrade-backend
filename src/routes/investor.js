const express = require("express");
const prisma = require("../db/prisma");
const { requireViewToken } = require("../middleware/requireViewToken");
const { generateViewToken } = require("../services/viewToken");

const router = express.Router();

/**
 * Investor-only read routes — deliberately a NARROWER surface than
 * /dashboard, not the same data behind a different header. Scoped to
 * exactly the member the caller's view token belongs to
 * (requireViewToken sets req.member; every query below uses req.member.id,
 * never req.params.memberId directly, so a mismatched/forged param can't
 * leak another member's data). No kill-switch, no onboarding, no group-
 * wide or other-member visibility anywhere in this file.
 */

router.get("/:memberId/overview", requireViewToken, async (req, res, next) => {
  try {
    const member = await prisma.member.findUnique({
      where: { id: req.member.id },
      include: {
        group: { select: { name: true } },
        riskProfile: true,
        orders: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    res.status(200).json({
      userId: member.userId,
      groupName: member.group.name,
      brokerType: member.brokerType,
      status: member.status,
      riskProfile: member.riskProfile,
      recentOrders: member.orders,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Same audit-trail data as /dashboard/member/:memberId/audit — this is the
 * investor's own version of it, scoped by view token instead of admin key.
 */
router.get("/:memberId/audit", requireViewToken, async (req, res, next) => {
  try {
    const decisions = await prisma.riskDecision.findMany({
      where: { memberId: req.member.id },
      include: { signal: true, order: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.status(200).json(decisions);
  } catch (err) {
    next(err);
  }
});

/**
 * The investor's own slice of Layer 3's transparency feed — their
 * per-trade notifications only, never the group's broker digest (that's
 * audience: "BROKER", scoped to groupId, and out of reach here entirely).
 */
router.get("/:memberId/notifications", requireViewToken, async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { memberId: req.member.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.status(200).json(notifications);
  } catch (err) {
    next(err);
  }
});

/**
 * Self-service rotation — an investor who still HAS a working token can
 * replace it themselves, no admin needed. This is intentionally the only
 * self-service path: someone who has LOST their token still has to ask an
 * admin (POST /onboarding/member/:memberId/view-token/regenerate) — there
 * is no "forgot my token" recovery flow, because there is nothing to
 * verify the requester's identity against other than the token itself.
 */
router.post("/:memberId/view-token/regenerate", requireViewToken, async (req, res, next) => {
  try {
    const { plaintext: viewTokenPlaintext, hash: viewTokenHash } = generateViewToken();
    await prisma.member.update({ where: { id: req.member.id }, data: { viewTokenHash } });

    res.status(200).json({
      viewTokenPlaintext,
      warning: "Save this view token now — it will not be shown again, and your previous token no longer works.",
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
