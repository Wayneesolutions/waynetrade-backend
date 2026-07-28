const axios = require("axios");

/**
 * Notifications — Telegram bot (the guide's Section 2 "Notifications" layer).
 *
 * Telegram over WhatsApp Business API for now: a bot token is free and takes
 * five minutes via @BotFather, while WhatsApp Business needs Meta approval,
 * a verified business, and per-message pricing. Same pattern, swappable later.
 *
 * Setup:
 *   1. Create a bot with @BotFather, put the token in TELEGRAM_BOT_TOKEN.
 *   2. Add the bot to the group chat (or DM it), send any message, then read
 *      the chat id from https://api.telegram.org/bot<token>/getUpdates and
 *      put it in TELEGRAM_CHAT_ID.
 *
 * Design rules:
 *   - Notifications must NEVER break the trading flow: every failure is
 *     caught and logged, nothing is thrown to callers.
 *   - Unconfigured = silent no-op (one startup log line), so dev/demo
 *     environments work without a bot.
 *   - Nothing sensitive goes into messages: no API keys, no broker
 *     credentials, no webhook secrets — member userId labels and amounts only.
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const enabled = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
if (!enabled) {
  console.log("[notifications] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set — notifications disabled");
}

async function send(text) {
  if (!enabled) return false;
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" },
      { timeout: 10000 }
    );
    return true;
  } catch (err) {
    console.error("[notifications] Telegram send failed:", err.response?.data?.description || err.message);
    return false;
  }
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One message per processed signal: what came in, who traded, who was rejected. */
function notifySignalProcessed({ strategyName, symbol, side, results }) {
  const lines = results.map((r) => {
    if (r.decision === "APPROVE") {
      return `• ${esc(r.memberLabel)}: ✅ approved${r.orderStatus ? ` → order ${esc(r.orderStatus)}` : ""}`;
    }
    return `• ${esc(r.memberLabel)}: ⛔ ${esc(r.reason || r.decision)}`;
  });
  return send(
    `📡 <b>Signal</b> — ${esc(strategyName)}\n` +
      `${esc(String(side).toUpperCase())} ${esc(symbol)}\n` +
      lines.join("\n")
  );
}

function notifyKillSwitch({ scope, label, action, triggeredBy, reason }) {
  const icon = action === "resume" ? "▶️" : "⏸";
  return send(
    `${icon} <b>Kill-switch ${esc(action)}</b> — ${esc(scope)} ${esc(label)}\n` +
      `By: ${esc(triggeredBy)}\nReason: ${esc(reason)}`
  );
}

function notifyOrderError({ memberLabel, symbol, detail }) {
  return send(
    `⚠️ <b>Order error</b> — ${esc(memberLabel)} (${esc(symbol)})\n${esc(detail)}\n` +
      `The order is marked ERROR in the audit trail — check the dashboard.`
  );
}

module.exports = { send, notifySignalProcessed, notifyKillSwitch, notifyOrderError };
