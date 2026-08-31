const express = require("express");
const prisma = require("../db/prisma");

const router = express.Router();

/**
 * Group overview — members, current status, order counts.
 * P&L calculation is NOT implemented yet: that requires pulling live
 * position/equity data back from MetaApi/Kite per account, which is a
 * separate polling or webhook integration not built in Phase 1.
 */
router.get("/group/:groupId", async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: {
            orders: { orderBy: { createdAt: "desc" }, take: 5 },
          },
        },
        strategies: true,
      },
    });

    if (!group) return res.status(404).json({ error: "Group not found" });

    res.status(200).json(group);
  } catch (err) {
    next(err);
  }
});

/**
 * Audit trail for a member — every risk decision + resulting order.
 */
router.get("/member/:memberId/audit", async (req, res, next) => {
  try {
    const { memberId } = req.params;

    const decisions = await prisma.riskDecision.findMany({
      where: { memberId },
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
 * Layer 3's transparency feed for a group — every investor per-trade
 * notification for the group's members, plus every broker digest sent to
 * the group itself. This is the dashboard read side of
 * notificationService.js; the WhatsApp push is a best-effort copy of the
 * same rows, this endpoint is the permanent record regardless of whether
 * that push succeeded.
 */
router.get("/group/:groupId/notifications", async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { limit } = req.query;

    const memberIds = (
      await prisma.member.findMany({ where: { groupId }, select: { id: true } })
    ).map((m) => m.id);

    const notifications = await prisma.notification.findMany({
      where: { OR: [{ groupId }, { memberId: { in: memberIds } }] },
      include: { member: { select: { userId: true } }, order: { select: { status: true } } },
      orderBy: { createdAt: "desc" },
      take: Number(limit) || 50,
    });

    res.status(200).json(notifications);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
