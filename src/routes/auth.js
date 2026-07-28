const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../db/prisma");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");

const router = express.Router();

const TOKEN_TTL = "12h"; // trading dashboard sessions — short-lived on purpose

function signToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role, memberId: user.memberId ?? null },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function requireJwtConfigured(req, res, next) {
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: "Server misconfigured: JWT_SECRET not set" });
  }
  next();
}

/**
 * One-time bootstrap: creates the FIRST admin user. Only works while the
 * users table is empty — after that it always 403s, so it can safely stay
 * enabled. Everyone else is created by an admin via POST /auth/users.
 */
router.post("/bootstrap-admin", requireJwtConfigured, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password || password.length < 8) {
      return res.status(400).json({ error: "email and password (min 8 chars) are required" });
    }

    const existing = await prisma.user.count();
    if (existing > 0) {
      return res.status(403).json({ error: "Bootstrap already done — ask an existing admin to create your account" });
    }

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash: await bcrypt.hash(password, 10),
        role: "ADMIN",
      },
    });

    res.status(201).json({ id: user.id, email: user.email, role: user.role, token: signToken(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/login", requireJwtConfigured, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    // Same error for unknown email and wrong password — don't leak which.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    res.status(200).json({
      token: signToken(user),
      user: { id: user.id, email: user.email, role: user.role, memberId: user.memberId },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Admin creates a user account, optionally linked to a members row (that
 * link is what scopes a MEMBER to "themselves" in kill-switch/dashboard).
 */
router.post("/users", requireJwtConfigured, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { email, password, role, memberId } = req.body;
    if (!email || !password || password.length < 8) {
      return res.status(400).json({ error: "email and password (min 8 chars) are required" });
    }
    if (role && !["ADMIN", "MEMBER"].includes(role)) {
      return res.status(400).json({ error: "role must be ADMIN or MEMBER" });
    }

    if (memberId) {
      const member = await prisma.member.findUnique({ where: { id: memberId } });
      if (!member) return res.status(404).json({ error: "memberId does not exist" });
    }

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash: await bcrypt.hash(password, 10),
        role: role || "MEMBER",
        memberId: memberId ?? null,
      },
    });

    res.status(201).json({ id: user.id, email: user.email, role: user.role, memberId: user.memberId });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "A user with that email (or linked member) already exists" });
    }
    next(err);
  }
});

router.get("/me", requireAuth, async (req, res) => {
  res.status(200).json(req.auth);
});

module.exports = router;
