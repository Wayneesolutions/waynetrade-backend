const crypto = require("crypto");

/**
 * Investor view tokens. One-way hashed (SHA-256) like a password, not
 * encrypted like the webhook secret — there's no need to ever recover the
 * plaintext, only compare against it, so a reversible cipher would be
 * unnecessary complexity here.
 */
function hashViewToken(plaintext) {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

function generateViewToken() {
  const plaintext = crypto.randomBytes(24).toString("hex");
  return { plaintext, hash: hashViewToken(plaintext) };
}

module.exports = { hashViewToken, generateViewToken };
