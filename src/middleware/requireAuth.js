const crypto = require("crypto");
const jwt = require("jsonwebtoken");

/**
 * Per-user auth with roles, replacing the "single shared admin key" limit.
 *
 * Two accepted credentials:
 *   1. Authorization: Bearer <JWT>  — issued by POST /auth/login. The token
 *      carries { userId, role, memberId } and is verified with JWT_SECRET.
 *   2. X-Api-Key: <ADMIN_API_KEY>  — the legacy shared key, kept so existing
 *      deployments and the dashboard's connect-by-key flow don't break.
 *      Treated as a full ADMIN with no user identity.
 *
 * Sets req.auth = { role: "ADMIN"|"MEMBER", userId|null, memberId|null, via }.
 * Route handlers use req.auth for member-scoping (a MEMBER may only act on
 * their own memberId / view their own group).
 */

function getJwtSecret() {
  return process.env.JWT_SECRET;
}

function tryApiKey(req) {
  const configuredKey = process.env.ADMIN_API_KEY;
  const provided = req.get("X-Api-Key");
  if (!configuredKey || !provided) return null;

  const a = Buffer.from(provided);
  const b = Buffer.from(configuredKey);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return { role: "ADMIN", userId: null, memberId: null, via: "api-key" };
}

function tryBearer(req) {
  const header = req.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const secret = getJwtSecret();
  if (!secret) return null;

  try {
    const payload = jwt.verify(header.slice("Bearer ".length), secret);
    return {
      role: payload.role,
      userId: payload.userId,
      memberId: payload.memberId ?? null,
      via: "jwt",
    };
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  if (!process.env.ADMIN_API_KEY && !process.env.JWT_SECRET) {
    // Fail closed, not open — no configured auth must never mean "no auth".
    return res.status(500).json({ error: "Server misconfigured: set JWT_SECRET and/or ADMIN_API_KEY" });
  }

  const auth = tryBearer(req) || tryApiKey(req);
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized — provide a Bearer token (POST /auth/login) or X-Api-Key" });
  }

  req.auth = auth;
  next();
}

/** Route-level guard for admin-only endpoints (after requireAuth). */
function requireAdmin(req, res, next) {
  if (req.auth?.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

/**
 * Member-scoping helper: true if this auth may act on the given memberId.
 * Admins may act on anyone; a MEMBER only on their own linked member row.
 */
function canActOnMember(auth, memberId) {
  if (auth.role === "ADMIN") return true;
  return auth.memberId != null && auth.memberId === memberId;
}

module.exports = { requireAuth, requireAdmin, canActOnMember };
