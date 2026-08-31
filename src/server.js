require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const webhookRoutes = require("./routes/webhook");
const killSwitchRoutes = require("./routes/killSwitch");
const dashboardRoutes = require("./routes/dashboard");
const onboardingRoutes = require("./routes/onboarding");
const researchRoutes = require("./routes/research");
const investorRoutes = require("./routes/investor");
const opsRoutes = require("./routes/ops");
const { requireApiKey } = require("./middleware/requireApiKey");

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
// Defense-in-depth against view-token guessing — the token itself is 192
// bits of randomness (see viewToken.js), so brute-forcing it isn't
// realistically feasible even without this, but rate-limiting the surface
// anyway costs nothing and matches this codebase's habit of not relying on
// a single control.
const investorLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

app.get("/health", (req, res) => res.json({ status: "ok", service: "waynetrade-backend" }));

// Webhook routes authenticate via per-strategy HMAC signature (TradingView
// side), not the admin API key — a TradingView alert can't send a header
// only humans know. Kill-switch and dashboard routes are for team/members,
// so they require the shared admin API key. Investor routes have their
// OWN per-member auth (requireViewToken, inside investor.js) — deliberately
// NOT the admin key, since an investor must never be able to reach
// anything wider than their own data.
app.use("/webhook", webhookLimiter, webhookRoutes);
app.use("/kill-switch", requireApiKey, killSwitchRoutes);
app.use("/dashboard", requireApiKey, dashboardRoutes);
app.use("/onboarding", requireApiKey, onboardingRoutes);
app.use("/research", requireApiKey, researchRoutes);
app.use("/investor", investorLimiter, investorRoutes);
app.use("/ops", requireApiKey, opsRoutes);

// Central error handler — never leak stack traces to clients.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`WayneTrade backend listening on port ${PORT}`));
