const crypto = require("crypto");

/**
 * Closes a Phase 1 gap: every non-webhook route was previously open to
 * anyone who could reach the server. This adds a single shared admin API
 * key check (header: X-Api-Key) for kill-switch and dashboard routes.
 *
 * HONEST LIMIT: this is one shared key for all admins (Sant/Mandeep/group
 * admins), not per-user accounts or RBAC. It stops the "wide open on the
 * internet" problem, but it is not the same as real login/RBAC — if the
 * group needs per-person permissions (e.g. only a group admin can pause
 * the whole group, but any member can pause only themselves), that needs
 * a real user/auth system, which is a bigger Phase 2/4 item, not this.
 *
 * Set ADMIN_API_KEY in your env. Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
 */
function requireApiKey(req, res, next) {
  const configuredKey = process.env.ADMIN_API_KEY;
  if (!configuredKey) {
    // Fail closed, not open — a missing config should never mean "no auth required".
    return res.status(500).json({ error: "Server misconfigured: ADMIN_API_KEY not set" });
  }

  const provided = req.get("X-Api-Key");
  if (!provided) {
    return res.status(401).json({ error: "Missing X-Api-Key header" });
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(configuredKey);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  next();
}

module.exports = { requireApiKey };
