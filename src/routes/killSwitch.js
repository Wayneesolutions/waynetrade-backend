const express = require("express");
const prisma = require("../db/prisma");

const router = express.Router();

/**
 * Pause a single member (manual kill-switch).
 * "No silent kill-switches" — every trigger is logged, per the data model notes.
 */
router.post("/member/:memberId", async (req, res, next) => {
  try {
    const { memberId } = req.params;
    const { triggeredBy, reason } = req.body;

    if (!triggeredBy || !reason) {
      return res.status(400).json({ error: "triggeredBy and reason are required" });
    }

    const [event, member] = await prisma.$transaction([
      prisma.killSwitchEvent.create({
        data: { memberId, triggeredBy, reason },
      }),
      prisma.member.update({ where: { id: memberId }, data: { status: "PAUSED" } }),
    ]);

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

    if (!triggeredBy || !reason) {
      return res.status(400).json({ error: "triggeredBy and reason are required" });
    }

    const [event, member] = await prisma.$transaction([
      prisma.killSwitchEvent.create({
        data: { memberId, triggeredBy, reason: `RESUME: ${reason}` },
      }),
      prisma.member.update({ where: { id: memberId }, data: { status: "ACTIVE" } }),
    ]);

    res.status(200).json({ event, member });
  } catch (err) {
    next(err);
  }
});

/**
 * Pause an entire group (e.g. strategy misbehaving, admin-level stop).
 */
router.post("/group/:groupId", async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { triggeredBy, reason } = req.body;

    if (!triggeredBy || !reason) {
      return res.status(400).json({ error: "triggeredBy and reason are required" });
    }

    const event = await prisma.killSwitchEvent.create({
      data: { groupId, triggeredBy, reason },
    });

    await prisma.member.updateMany({
      where: { groupId },
      data: { status: "PAUSED" },
    });

    res.status(200).json({ event });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
