const express = require("express");
const prisma = require("../db/prisma");
const { canActOnMember } = require("../middleware/requireAuth");
const { getAccountInformation, getPositions } = require("../services/metaApiBridge");

const router = express.Router();

/**
 * RBAC scoping (req.auth set by requireAuth in server.js):
 *   - ADMIN sees everything.
 *   - MEMBER sees only their own group's overview, and only their OWN
 *     audit trail / live account data.
 */

async function memberBelongsToGroup(auth, groupId) {
  if (auth.role === "ADMIN") return true;
  if (!auth.memberId) return false;
  const member = await prisma.member.findUnique({ where: { id: auth.memberId } });
  return member?.groupId === groupId;
}

/**
 * Group overview — members, current status, order counts.
 */
router.get("/group/:groupId", async (req, res, next) => {
  try {
    const { groupId } = req.params;

    if (!(await memberBelongsToGroup(req.auth, groupId))) {
      return res.status(403).json({ error: "You can only view your own group" });
    }

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: {
            orders: { orderBy: { createdAt: "desc" }, take: 5 },
            riskProfile: true,
          },
        },
        strategies: { where: { archived: false } },
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

    if (!canActOnMember(req.auth, memberId)) {
      return res.status(403).json({ error: "You can only view your own audit trail" });
    }

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
 * Live account data for one member, straight from MetaApi: balance, equity,
 * open positions with their floating P&L. Closes the "no live P&L" gap —
 * this is real broker-side data, not our own DB.
 *
 * Side effect: every successful poll also writes an equity_snapshots row, which
 * is what feeds the P&L-over-time chart (history accrues while anyone is
 * watching the dashboard — no separate polling worker needed yet).
 *
 * Only implemented for METATRADER members; Kite live data is a Phase 3 item.
 */
router.get("/member/:memberId/live", async (req, res, next) => {
  try {
    const { memberId } = req.params;

    if (!canActOnMember(req.auth, memberId)) {
      return res.status(403).json({ error: "You can only view your own live data" });
    }

    const member = await prisma.member.findUnique({ where: { id: memberId } });
    if (!member) return res.status(404).json({ error: "Member not found" });
    if (member.brokerType !== "METATRADER") {
      return res.status(400).json({ error: "Live data is only implemented for MetaTrader members (Kite is Phase 3)" });
    }

    const [accountInformation, positions] = await Promise.all([
      getAccountInformation(member.brokerAccountRef),
      getPositions(member.brokerAccountRef),
    ]);

    if (
      accountInformation &&
      typeof accountInformation.balance === "number" &&
      typeof accountInformation.equity === "number"
    ) {
      await prisma.equitySnapshot.create({
        data: {
          memberId,
          balance: accountInformation.balance,
          equity: accountInformation.equity,
          currency: accountInformation.currency || "USD",
        },
      });
    }

    res.status(200).json({ accountInformation, positions });
  } catch (err) {
    // MetaApi being unreachable/unconfigured is an expected state (no token
    // yet, demo account not provisioned) — surface it as a clean 502 with
    // the reason, not a generic 500.
    res.status(502).json({ error: err.message });
  }
});

/**
 * Live overview for a whole group — polls MetaApi per MetaTrader member.
 * Per-member failures don't sink the rest: each entry carries ok/error.
 */
router.get("/group/:groupId/live", async (req, res, next) => {
  try {
    const { groupId } = req.params;

    if (!(await memberBelongsToGroup(req.auth, groupId))) {
      return res.status(403).json({ error: "You can only view your own group" });
    }

    const members = await prisma.member.findMany({
      where: { groupId, status: { not: "REMOVED" } },
    });

    const results = await Promise.all(
      members.map(async (member) => {
        if (member.brokerType !== "METATRADER") {
          return { memberId: member.id, ok: false, error: "Live data only for MetaTrader (Kite is Phase 3)" };
        }
        try {
          const accountInformation = await getAccountInformation(member.brokerAccountRef);
          if (
            accountInformation &&
            typeof accountInformation.balance === "number" &&
            typeof accountInformation.equity === "number"
          ) {
            await prisma.equitySnapshot.create({
              data: {
                memberId: member.id,
                balance: accountInformation.balance,
                equity: accountInformation.equity,
                currency: accountInformation.currency || "USD",
              },
            });
          }
          return { memberId: member.id, ok: true, accountInformation };
        } catch (err) {
          return { memberId: member.id, ok: false, error: err.message };
        }
      })
    );

    res.status(200).json(results);
  } catch (err) {
    next(err);
  }
});

/**
 * Equity history for the P&L-over-time chart — the snapshots captured by
 * the live routes above. In account currency, not %, per the guide's
 * "P&L in currency not just %" requirement.
 */
router.get("/member/:memberId/equity-history", async (req, res, next) => {
  try {
    const { memberId } = req.params;

    if (!canActOnMember(req.auth, memberId)) {
      return res.status(403).json({ error: "You can only view your own equity history" });
    }

    const snapshots = await prisma.equitySnapshot.findMany({
      where: { memberId },
      orderBy: { capturedAt: "asc" },
      take: 500,
    });

    res.status(200).json(snapshots);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
