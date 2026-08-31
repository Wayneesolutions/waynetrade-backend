const express = require("express");
const prisma = require("../db/prisma");
const { runScan } = require("../services/researchAssistant");

const router = express.Router();

/**
 * Broker-facing feed — Layer 2's output. Admin-API-key protected, same as
 * /dashboard. Pass groupId to see that group's signals plus platform-wide
 * ones (groupId null on the row); omit it to see everything.
 */
router.get("/feed", async (req, res, next) => {
  try {
    const { groupId, limit } = req.query;
    const signals = await prisma.researchSignal.findMany({
      where: groupId ? { OR: [{ groupId: String(groupId) }, { groupId: null }] } : {},
      orderBy: { createdAt: "desc" },
      take: Number(limit) || 50,
    });
    res.status(200).json(signals);
  } catch (err) {
    next(err);
  }
});

/**
 * Triggers one scan pass. Meant to be hit by an external cron (Render Cron
 * Job, Railway Cron, etc.), same pattern as saaf-signal-backend's
 * scheduler.py hitting /check-outcomes and /scan-watchlist — no in-process
 * scheduler here, see researchAssistant.js's header comment.
 */
router.post("/scan", async (req, res, next) => {
  try {
    const { groupId, query, pageSize } = req.body;
    const result = await runScan({
      groupId: groupId ?? null,
      query,
      pageSize: pageSize ?? 10,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
