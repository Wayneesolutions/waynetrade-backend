const crypto = require("crypto");
const prisma = require("../db/prisma");
const { hashViewToken } = require("../services/viewToken");

/**
 * Per-member investor auth — completely separate from requireApiKey.
 * Grants access to exactly the :memberId in the URL, nothing else: no
 * kill-switch, no onboarding, no other members' data. A member with no
 * view token issued yet (viewTokenHash null) rejects every request — same
 * "reject rather than guess" rule the rest of this codebase follows, no
 * fallback/default access.
 */
async function requireViewToken(req, res, next) {
  try {
    const { memberId } = req.params;
    const provided = req.get("X-View-Token");
    if (!provided) {
      return res.status(401).json({ error: "Missing X-View-Token header" });
    }

    const member = await prisma.member.findUnique({ where: { id: memberId } });
    if (!member || !member.viewTokenHash) {
      return res.status(404).json({ error: "Member not found or no view token issued yet" });
    }

    const providedHash = hashViewToken(provided);
    const a = Buffer.from(providedHash);
    const b = Buffer.from(member.viewTokenHash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: "Invalid view token" });
    }

    req.member = member;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireViewToken };
