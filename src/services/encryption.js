const crypto = require("crypto");

/**
 * Closes a Phase 1 gap: strategy webhook secrets used to be described as a
 * "hash" in the DB, but HMAC verification needs the original secret back,
 * not a one-way hash of it. This module encrypts secrets at rest (AES-256-GCM)
 * using a single app-level key (ENCRYPTION_KEY), and decrypts them only at
 * the moment of verifying an incoming webhook signature.
 *
 * ENCRYPTION_KEY must be a 32-byte key, hex-encoded (64 hex chars). Generate
 * one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * Store it in your deployment platform's secret manager (Railway variables,
 * etc.) — never commit it, and rotating it means re-encrypting all
 * strategies.webhookSecretEncrypted values.
 */

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be set to a 64-char hex string (32 bytes). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(hex, "hex");
}

function encryptSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12); // GCM standard IV size
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

function decryptSecret(stored) {
  const key = getKey();
  const [ivHex, tagHex, dataHex] = String(stored).split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Malformed encrypted secret — expected iv:authTag:ciphertext");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

module.exports = { encryptSecret, decryptSecret };
