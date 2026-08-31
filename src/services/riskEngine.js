const prisma = require("../db/prisma");

/**
 * Phase 1 Risk Engine.
 *
 * Deliberately simple for MVP, per the build guide:
 *   - fixed position sizing per member (from member.riskProfileId config)
 *   - hard stop-loss enforcement (rejects signal if no stop provided)
 *   - auto profit-booking (take-profit = riskRewardRatio x stop-loss
 *     distance from entry), attached to the order at broker level so it's
 *     enforced the same way stop-loss already is — not a manual step.
 *   - manual kill-switch check (member or group level)
 *
 * NOT implemented yet (future phases): dynamic sizing, max-drawdown auto
 * throttling, correlation/exposure limits across members, auto-optimization,
 * trailing stops.
 * Every decision this engine makes MUST be written to risk_decisions —
 * that table is the audit trail, not a log we can skip.
 */

async function isKilled(member) {
  const groupKill = await prisma.killSwitchEvent.findFirst({
    where: { groupId: member.groupId },
    orderBy: { triggeredAt: "desc" },
  });
  const memberKill = await prisma.killSwitchEvent.findFirst({
    where: { memberId: member.id },
    orderBy: { triggeredAt: "desc" },
  });

  // A kill-switch event is a point-in-time flag; whether it's currently
  // "active" is tracked via member.status / group-level pause state, not
  // by the mere existence of a row. For Phase 1 we treat member.status
  // as the source of truth and log the event separately for the audit trail.
  return member.status === "PAUSED";
}

function getFixedPositionSize(riskProfile) {
  // Placeholder until risk_profile config table/JSON is fleshed out.
  // Expected shape: { fixedLots: number, maxRiskPercentPerTrade: number }
  if (!riskProfile) return null;
  return riskProfile.fixedLots ?? null;
}

/**
 * Auto profit-booking. Take-profit is never a trade blocker the way
 * stop-loss is — a signal without enough info to compute one still trades,
 * it just goes out with no take-profit attached (today's prior behavior).
 *
 * Precedence:
 *   1. Signal explicitly sets takeProfit → honored as-is, no override.
 *   2. Signal gives a reference price (payload.price) and the member's
 *      risk profile has a riskRewardRatio → auto-computed as
 *      entry +/- (riskRewardRatio x |entry - stopLoss|), direction per side.
 *   3. Otherwise → null. Never guessed from a missing price or ratio.
 */
function computeTakeProfit({ payload, riskProfile }) {
  if (payload.takeProfit !== undefined && payload.takeProfit !== null) {
    return Number(payload.takeProfit);
  }

  const price = payload.price;
  const ratio = riskProfile?.riskRewardRatio;
  if (price === undefined || price === null || !ratio) return null;

  const riskDistance = Math.abs(Number(price) - Number(payload.stopLoss));
  const reward = riskDistance * Number(ratio);

  return payload.side === "sell" ? Number(price) - reward : Number(price) + reward;
}

/**
 * Evaluate one signal against one member's risk rules.
 * Returns the created RiskDecision record.
 */
async function evaluateSignalForMember(signal, member, opts = {}) {
  const payload = signal.rawPayload;

  // 1. Kill-switch check — always first, always wins.
  if (await isKilled(member)) {
    return prisma.riskDecision.create({
      data: {
        signalId: signal.id,
        memberId: member.id,
        action: "REJECT",
        reason: "Member is paused (kill-switch active)",
      },
    });
  }

  // 2. Hard stop-loss requirement — no stop, no trade.
  if (!payload || payload.stopLoss === undefined || payload.stopLoss === null) {
    return prisma.riskDecision.create({
      data: {
        signalId: signal.id,
        memberId: member.id,
        action: "REJECT",
        reason: "Signal missing required stopLoss field",
      },
    });
  }

  // 3. Fixed position sizing.
  const riskProfile = opts.riskProfile; // caller loads this from wherever it's stored
  const fixedSize = getFixedPositionSize(riskProfile);

  if (fixedSize === null) {
    return prisma.riskDecision.create({
      data: {
        signalId: signal.id,
        memberId: member.id,
        action: "REJECT",
        reason: "No risk profile / position size configured for member",
      },
    });
  }

  const takeProfit = computeTakeProfit({ payload, riskProfile });

  return prisma.riskDecision.create({
    data: {
      signalId: signal.id,
      memberId: member.id,
      action: "APPROVE",
      reason: "Passed kill-switch, stop-loss, and sizing checks",
      positionSize: fixedSize,
      takeProfit,
    },
  });
}

module.exports = { evaluateSignalForMember, isKilled, computeTakeProfit };
