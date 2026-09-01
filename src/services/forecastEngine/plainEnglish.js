/**
 * Translates a prediction into a plain-chat answer for non-technical users.
 * Template-based (no external API needed) — same honesty rules as the
 * original: always state the track record, always include the disclaimer,
 * never claim certainty.
 */
function explain(pred, trackRecord) {
  const directionPhrase = {
    bullish: "showing a positive short-term signal",
    bearish: "showing a negative short-term signal",
    neutral: "not showing a clear signal either way right now",
  }[pred.technicalDirection];

  const accPhrase =
    trackRecord && trackRecord.totalChecked >= 5
      ? ` So far, this kind of signal has been right about ${trackRecord.accuracyPct}% of the time across ${trackRecord.totalChecked} checked predictions.`
      : " We don't have enough tracked history yet to say how reliable this type of call has been — treat it cautiously.";

  const rangePhrase = ` Based on how this stock has historically moved in similar situations, it could land somewhere between ₹${pred.predictedLow} and ₹${pred.predictedHigh} over the next ${pred.horizonDays} trading days.`;

  const disclaimer =
    " This is an educational forecast based on historical patterns, not financial advice — please do your own research before making any decisions.";

  return `${pred.ticker} is currently ${directionPhrase}.${accPhrase}${rangePhrase}${disclaimer}`;
}

module.exports = { explain };
