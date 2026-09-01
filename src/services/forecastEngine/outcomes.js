const prisma = require("../../db/prisma");
const { fetchCurrentPrice } = require("./data");

/**
 * Checks matured predictions (target_date has passed) against what
 * ACTUALLY happened, and records it — permanently, whether the prediction
 * was right or wrong. This table is never edited to look better after the
 * fact.
 */
async function checkMaturedPredictions() {
  const matured = await prisma.forecastPrediction.findMany({
    where: { outcomeChecked: false, targetDate: { lte: new Date() } },
  });

  const checked = [];
  for (const pred of matured) {
    let actual;
    try {
      actual = await fetchCurrentPrice(pred.ticker);
    } catch (err) {
      // Don't silently mark as checked if we couldn't get real data — that
      // would be a gap in the honesty ledger, not a resolved prediction.
      console.error(`Outcome check: failed to fetch current price for ${pred.ticker}:`, err.message);
      continue;
    }

    const priceAtPrediction = Number(pred.priceAtPrediction);
    const predictedMid = (Number(pred.predictedLow) + Number(pred.predictedHigh)) / 2;
    const actualDirectionUp = actual > priceAtPrediction;

    let directionCorrect;
    if (pred.technicalDirection === "bullish") {
      directionCorrect = actualDirectionUp;
    } else if (pred.technicalDirection === "bearish") {
      directionCorrect = !actualDirectionUp;
    } else {
      // Neutral prediction — count correct if price stayed within +-1.5%.
      directionCorrect = Math.abs(actual - priceAtPrediction) / priceAtPrediction <= 0.015;
    }

    const priceErrorPct = Math.round((((actual - predictedMid) / priceAtPrediction) * 100) * 100) / 100;

    const updated = await prisma.forecastPrediction.update({
      where: { id: pred.id },
      data: {
        actualPrice: actual,
        directionCorrect,
        priceErrorPct,
        outcomeChecked: true,
      },
    });
    checked.push(updated);
  }

  return checked;
}

/**
 * Aggregate honesty stats. ticker=null returns global stats. This is what
 * powers the public Track Record page — including the losses.
 */
async function getTrackRecord(ticker = null) {
  const where = { outcomeChecked: true, ...(ticker ? { ticker } : {}) };
  const checked = await prisma.forecastPrediction.findMany({ where });

  if (checked.length === 0) {
    return { totalChecked: 0, correct: 0, incorrect: 0, accuracyPct: null, avgPriceErrorPct: null };
  }

  const correct = checked.filter((p) => p.directionCorrect).length;
  const incorrect = checked.length - correct;
  const avgError = checked.reduce((sum, p) => sum + Math.abs(Number(p.priceErrorPct)), 0) / checked.length;

  return {
    totalChecked: checked.length,
    correct,
    incorrect,
    accuracyPct: Math.round((correct / checked.length) * 1000) / 10,
    avgPriceErrorPct: Math.round(avgError * 100) / 100,
  };
}

module.exports = { checkMaturedPredictions, getTrackRecord };
