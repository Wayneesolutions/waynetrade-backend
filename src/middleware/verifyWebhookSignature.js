const crypto = require("crypto");

/**
 * Verifies an incoming TradingView (or custom strategy) webhook is signed
 * with the strategy's registered secret. Expects header: X-Signature (hex HMAC-SHA256
 * of the raw request body using the strategy's webhook secret).
 *
 * IMPORTANT: this middleware expects `req.rawBody` to be populated — see
 * the express.json({ verify }) config in server.js.
 */
function verifyWebhookSignature(getSecretForStrategy) {
  return async (req, res, next) => {
    try {
      const signature = req.get("X-Signature");
      const strategyId = req.params.strategyId || req.body?.strategyId;

      if (!signature || !strategyId) {
        return res.status(401).json({ error: "Missing signature or strategyId" });
      }

      const secret = await getSecretForStrategy(strategyId);
      if (!secret) {
        return res.status(404).json({ error: "Unknown strategy" });
      }

      const expected = crypto
        .createHmac("sha256", secret)
        .update(req.rawBody || "")
        .digest("hex");

      const sigBuf = Buffer.from(signature, "hex");
      const expBuf = Buffer.from(expected, "hex");

      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return res.status(401).json({ error: "Invalid signature" });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { verifyWebhookSignature };
