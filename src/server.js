require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const webhookRoutes = require("./routes/webhook");
const killSwitchRoutes = require("./routes/killSwitch");
const dashboardRoutes = require("./routes/dashboard");
const onboardingRoutes = require("./routes/onboarding");
const authRoutes = require("./routes/auth");
const { requireAuth, requireAdmin } = require("./middleware/requireAuth");

const app = express();

app.use(helmet());
app.use(cors());

// Capture raw body for HMAC signature verification on webhook routes.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 }); // brute-force brake on login

app.get("/health", (req, res) => res.json({ status: "ok", service: "waynetrade-backend" }));

// Webhook routes authenticate via per-strategy HMAC signature (TradingView
// side) — a TradingView alert can't send a header only humans know.
// Everything else requires auth: a per-user JWT (POST /auth/login) or the
// legacy shared admin API key (X-Api-Key, treated as ADMIN). Member-level
// scoping (pause only yourself, see only your own group/audit) is enforced
// inside the kill-switch and dashboard routes; onboarding is admin-only.
app.use("/webhook", webhookLimiter, webhookRoutes);
app.use("/auth", authLimiter, authRoutes);
app.use("/kill-switch", requireAuth, killSwitchRoutes);
app.use("/dashboard", requireAuth, dashboardRoutes);
app.use("/onboarding", requireAuth, requireAdmin, onboardingRoutes);

// Central error handler — never leak stack traces to clients.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`WayneTrade backend listening on port ${PORT}`));
