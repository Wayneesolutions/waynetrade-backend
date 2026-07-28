#!/usr/bin/env node
/**
 * Generates a random webhook secret for a new strategy and prints:
 *   1. The plaintext secret — paste this into the TradingView alert's
 *      webhook config (used to compute the X-Signature HMAC).
 *   2. The encrypted value — save this into strategies.webhook_secret_encrypted.
 *
 * Requires ENCRYPTION_KEY to already be set in the environment (same value
 * the running server uses), so it must decrypt back correctly at request time.
 *
 * Usage: node scripts/generate-strategy-secret.js
 */
require("dotenv").config();
const crypto = require("crypto");
const { encryptSecret } = require("../src/services/encryption");

const plaintextSecret = crypto.randomBytes(32).toString("hex");
const encrypted = encryptSecret(plaintextSecret);

console.log("Plaintext secret (put this in TradingView's alert webhook config):");
console.log(plaintextSecret);
console.log("");
console.log("Encrypted value (save this into strategies.webhook_secret_encrypted):");
console.log(encrypted);
