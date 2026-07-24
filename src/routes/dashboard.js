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

module.exports = router;
