const express = require("express");
const { retryUnprotectedOrders } = require("../services/reconciliation");

const router = express.Router();

/**
 * Operational/maintenance routes — admin-key protected, meant for cron
 * jobs and manual ops intervention, not end-user or investor traffic.
 */

/**
 * Retries the protective GTT for every Kite Connect order that's SENT but
 * still has no protectiveTriggerRef — see reconciliation.js. Meant to be
 * hit periodically by an external cron; also safe to call manually after
 * noticing a specific failure (e.g. from a protectionWarning notification).
 */
router.post("/retry-unprotected-orders", async (req, res, next) => {
  try {
    const results = await retryUnprotectedOrders();
    res.status(200).json({
      checked: results.length,
      nowProtected: results.filter((r) => r.status === "now_protected").length,
      stillUnprotected: results.filter((r) => r.status === "still_unprotected").length,
      results,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
