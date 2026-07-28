const express = require("express");
const prisma = require("../db/prisma");
const { requireAdmin, canActOnMember } = require("../middleware/requireAuth");
const notifications = require("../services/notifications");

const router = express.Router();

/**
 * RBAC scoping (req.auth is set by requireAuth in server.js):
 *   - Any MEMBER may pause/resume THEMSELVES — pausing your own trading
 *     must never require finding an admin first.
 *   - Only an ADMIN may pause/resume someone else, or a whole group.
 * "No silent kill-switches" — every trigger is logged and notified.
 */

function triggeredByLabel(req, fallback) {
  // With a JWT we know exactly who acted; the legacy shared key can't tell
  // us, so we keep requiring an explicit triggeredBy in the body.
  return req.auth?.via === "jwt" ? `user:${req.auth.userId}` : fallback;
}

/**
 * Pause a single member (manual kill-switch).
 */
router.post("/member/:memberId", async (req, res, next) => {
  try {
    const { memberId } = req.params;
    const { triggeredBy, reason } = req.body;

    if (!reason || (!triggeredBy && req.auth?.via !== "jwt")) {
      return res.status(400).json({ error: "triggeredBy and reason are required" });
    }
    if (!canActOnMember(req.auth, memberId)) {
      return res.status(403).json({ error: "You can only pause your own account" });
    }

    const by = triggeredByLabel(req, triggeredBy);
    const [event, member] = await prisma.$transaction([
      prisma.killSwitchEvent.create({
        data: { memberId, triggeredBy: by, reason },
      }),
      prisma.member.update({ where: { id: memberId }, data: { status: "PAUSED" } }),
    ]);

    notifications.notifyKillSwitch({
      scope: "member",
      label: member.userId,
      action: "pause",
      triggeredBy: by,
      reason,
    });

    res.status(200).json({ event, member });
  } catch (err) {
    next(err);
  }
});

/**
 * Resume a paused member.
 */
router.post("/member/:memberId/resume", async (req, res, next) => {
  try {
    const { memberId } = req.params;
    const { triggeredBy, reason } = req.body;

    if (!reason || (!triggeredBy && req.auth?.via !== "jwt")) {
      return res.status(400).json({ error: "triggeredBy and reason are required" });
    }
    if (!canActOnMember(req.auth, memberId)) {
      return res.status(403).json({ error: "You can only resume your own account" });
    }

    const by = triggeredByLabel(req, triggeredBy);
    const [event, member] = await prisma.$transaction([
      prisma.killSwitchEvent.create({
        data: { memberId, triggeredBy: by, reason: `RESUME: ${reason}` },
      }),
      prisma.member.update({ where: { id: memberId }, data: { status: "ACTIVE" } }),
    ]);

    notifications.notifyKillSwitch({
      scope: "member",
      label: member.userId,
      action: "resume",
      triggeredBy: by,
      reason,
    });

    res.status(200).json({ event, member });
  } catch (err) {
    next(err);
  }
});

/**
 * Pause an entire group (e.g. strategy misbehaving, admin-level stop).
 * Admin-only: a single member must not be able to halt everyone else.
 */
router.post("/group/:groupId", requireAdmin, async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { triggeredBy, reason } = req.body;

    if (!reason || (!triggeredBy && req.auth?.via !== "jwt")) {
      return res.status(400).json({ error: "triggeredBy and reason are required" });
    }

    const by = triggeredByLabel(req, triggeredBy);
    const event = await prisma.killSwitchEvent.create({
      data: { groupId, triggeredBy: by, reason },
    });

    await prisma.member.updateMany({
      where: { groupId },
      data: { status: "PAUSED" },
    });

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    notifications.notifyKillSwitch({
      scope: "group",
      label: group?.name ?? groupId,
      action: "pause",
      triggeredBy: by,
      reason,
    });

    res.status(200).json({ event });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
