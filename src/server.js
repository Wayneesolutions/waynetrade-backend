require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const webhookRoutes = require("./routes/webhook");
const killSwitchRoutes = require("./routes/killSwitch");
const dashboardRoutes = require("./routes/dashboard");

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

app.get("/health", (req, res) => res.json({ status: "ok", service: "waynetrade-backend" }));

app.use("/webhook", webhookLimiter, webhookRoutes);
app.use("/kill-switch", killSwitchRoutes);
app.use("/dashboard", dashboardRoutes);

// Central error handler — never leak stack traces to clients.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`WayneTrade backend listening on port ${PORT}`));
