const prisma = require("../db/prisma");

/**
 * Layer 3 — real-time transparency notifications.
 *
 * Two audiences, two very different jobs:
 *   - INVESTOR: one message per trade, past-tense, plain-language, tied to
 *     THEIR account ("bought X, here's why, here's your stop/target").
 *     Never forward-looking advice — explaining what already happened is
 *     what keeps this out of investment-advice territory.
 *   - BROKER: a batched research-digest style message (Layer 2's flagged
 *     news/signals), not one push per trade across every client. This
 *     module only exposes the send primitive for that; Layer 2 owns the
 *     batching/scheduling logic.
 *
 * Every notification is written to `notifications` first — that's the
 * dashboard's source of truth — and WhatsApp delivery is best-effort on
 * top. A Twilio failure (or Twilio not being configured at all) must never
 * make the trade/decision itself disappear from the record.
 */

let twilioClient = null;
function getTwilioClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  if (!twilioClient) {
    twilioClient = require("twilio")(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

async function sendWhatsapp(toNumber) {
  const client = getTwilioClient();
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!client || !from || !toNumber) return "SKIPPED_NOT_CONFIGURED";
  return { client, from };
}

/**
 * Persists the notification row first (always), then attempts WhatsApp
 * delivery best-effort and updates the row's whatsappStatus with the
 * outcome. Returns the final Notification record.
 */
async function persistAndDeliver({ data, toNumber, body }) {
  const notification = await prisma.notification.create({ data });

  const sendable = await sendWhatsapp(toNumber);
  if (sendable === "SKIPPED_NOT_CONFIGURED") {
    return prisma.notification.update({
      where: { id: notification.id },
      data: { whatsappStatus: "SKIPPED_NOT_CONFIGURED" },
    });
  }

  try {
    await sendable.client.messages.create({
      from: `whatsapp:${sendable.from}`,
      to: `whatsapp:${toNumber}`,
      body,
    });
    return prisma.notification.update({
      where: { id: notification.id },
      data: { whatsappStatus: "SENT" },
    });
  } catch (err) {
    console.error(`WhatsApp send failed for notification ${notification.id}:`, err.message);
    return prisma.notification.update({
      where: { id: notification.id },
      data: { whatsappStatus: "FAILED" },
    });
  }
}

function formatMoney(value) {
  if (value === null || value === undefined) return null;
  return Number(value).toString();
}

/**
 * Builds the plain-language, past-tense explanation for one order outcome
 * and delivers it to the investor whose account it happened in.
 *
 * order.status is already resolved by the caller (SENT/FILLED = placed,
 * REJECTED/ERROR = did not go through) — both cases get a message. Showing
 * a failed/rejected order with the same weight as a filled one is the same
 * "wins and losses shown identically" rule the forecast engine uses.
 */
async function notifyInvestorOfOrder({ order, member, decision, signal, strategyName, protectionWarning }) {
  const payload = signal.rawPayload || {};
  const symbol = payload.symbol;
  const side = (payload.side || "").toUpperCase();
  const placed = order.status === "SENT" || order.status === "FILLED";

  const lines = [];
  // A failed protective GTT (Kite equities only) leads the message — this
  // is more urgent than the rest of the trade explanation, never buried
  // under it.
  if (protectionWarning) lines.push(`⚠️ ${protectionWarning}`);
  if (placed) {
    lines.push(`${side} ${decision.positionSize ?? ""} ${symbol} placed in your account.`.replace(/\s+/g, " ").trim());
    const sl = formatMoney(payload.stopLoss);
    const tp = formatMoney(decision.takeProfit);
    if (sl) lines.push(`Stop-loss: ${sl}${tp ? `, Take-profit: ${tp}` : ""}`);
  } else {
    lines.push(`${side} ${symbol} was NOT placed (status: ${order.status}).`.replace(/\s+/g, " ").trim());
  }
  lines.push(`Reason: ${decision.reason}${strategyName ? ` (strategy: ${strategyName})` : ""}`);

  const message = lines.join("\n");

  return persistAndDeliver({
    data: {
      audience: "INVESTOR",
      memberId: member.id,
      orderId: order.id,
      message,
    },
    toNumber: member.whatsappNumber,
    body: message,
  });
}

/**
 * Sends one batched research-digest message to a group's broker. Layer 2
 * decides what goes in `message` and how often this is called — this
 * function only handles persistence + delivery, per the module's job split.
 */
async function notifyBrokerDigest({ groupId, message, whatsappNumber }) {
  return persistAndDeliver({
    data: {
      audience: "BROKER",
      groupId,
      message,
    },
    toNumber: whatsappNumber,
    body: message,
  });
}

module.exports = { notifyInvestorOfOrder, notifyBrokerDigest };
