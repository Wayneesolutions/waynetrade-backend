const express = require("express");
const prisma = require("../db/prisma");
const { fetchHistory } = require("../services/forecastEngine/data");
const { generateForecast } = require("../services/forecastEngine/forecast");
const { checkMaturedPredictions, getTrackRecord } = require("../services/forecastEngine/outcomes");
const { explain } = require("../services/forecastEngine/plainEnglish");
const { scanUniverse, DEFAULT_UNIVERSE } = require("../services/forecastEngine/screener");
const { getEventSignal } = require("../services/forecastEngine/newsEvents");

/**
 * Saaf Signal's forecast engine, absorbed in-process (see
 * docs/HANDOVER.md — this used to be the separate saaf-signal-backend
 * repo). Deliberately mounted WITHOUT requireApiKey, same as the original
 * standalone service: these endpoints were always public (no broker/admin
 * gate), which is also the exact finding flagged in
 * docs/RA_RIA_DECISION_SUPPORT.md — moving the code in-process doesn't
 * change that finding, it just relocates it. Read that doc before changing
 * this route's auth.
 */

const router = express.Router();

const DISCLAIMER =
  "Educational forecast based on historical patterns only. Not financial advice. Do your own research before buying or selling anything.";

// Matches the dashboard's tier labels. Small sample size overrides
// everything else — a confident-looking number backed by few historical
// occurrences is speculative, full stop, regardless of how high the
// confidence reads.
function reliabilityTier(confidence, nSamples) {
  if (nSamples != null && nSamples < 30) return "Speculative";
  if (confidence >= 65) return "High conviction";
  if (confidence >= 55) return "Worth watching";
  return "Coin flip";
}

// Shared logic: fetch + backtest. Does NOT touch the database.
async function runForecast(ticker) {
  const bars = await fetchHistory(ticker, { days: 730 });
  const result = generateForecast(bars, ticker);
  result.ticker = ticker.toUpperCase();
  result.reliabilityTier = reliabilityTier(result.technicalConfidence, result.nSamples);
  result.disclaimer = DISCLAIMER;
  return result;
}

function handleForecastError(err, res) {
  if (/not enough historical data/i.test(err.message) || /no data returned/i.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }
  console.error("Forecast fetch failed:", err.message);
  return res.status(502).json({ error: `Data fetch failed: ${err.message}` });
}

// --- Read-only "signal" endpoints: safe to call on every page load, never logs ---

router.get("/signal/:ticker", async (req, res) => {
  try {
    const result = await runForecast(req.params.ticker);
    res.json(result);
  } catch (err) {
    handleForecastError(err, res);
  }
});

router.get("/signal/:ticker/explain", async (req, res) => {
  try {
    const result = await runForecast(req.params.ticker);
    const tr = await getTrackRecord(result.ticker);
    const text = explain(result, tr);
    res.json({
      ticker: result.ticker,
      answer: text,
      confidence: result.technicalConfidence,
      nSamples: result.nSamples,
      direction: result.technicalDirection,
    });
  } catch (err) {
    handleForecastError(err, res);
  }
});

// --- Logging endpoints: each call creates a permanent, trackable prediction row ---

async function predictAndLog(ticker) {
  const result = await runForecast(ticker);
  const targetDate = new Date(Date.now() + result.horizonDays * 1.45 * 24 * 60 * 60 * 1000);

  const pred = await prisma.forecastPrediction.create({
    data: {
      ticker: result.ticker,
      priceAtPrediction: result.priceAtPrediction,
      technicalDirection: result.technicalDirection,
      technicalConfidence: result.technicalConfidence,
      technicalBasis: result.technicalBasis,
      nSamples: result.nSamples,
      predictedLow: result.predictedLow,
      predictedHigh: result.predictedHigh,
      horizonDays: result.horizonDays,
      targetDate,
    },
  });

  return {
    id: pred.id,
    ticker: pred.ticker,
    priceAtPrediction: Number(pred.priceAtPrediction),
    priceChangePct: result.priceChangePct,
    technicalDirection: pred.technicalDirection,
    technicalConfidence: Number(pred.technicalConfidence),
    technicalBasis: pred.technicalBasis,
    predictedLow: Number(pred.predictedLow),
    predictedHigh: Number(pred.predictedHigh),
    horizonDays: pred.horizonDays,
    targetDate: pred.targetDate.toISOString(),
    nSamples: result.nSamples,
    reliabilityTier: result.reliabilityTier,
    disclaimer: DISCLAIMER,
  };
}

router.post("/predict/:ticker", async (req, res) => {
  try {
    const result = await predictAndLog(req.params.ticker);
    res.json(result);
  } catch (err) {
    handleForecastError(err, res);
  }
});

router.post("/predict/:ticker/explain", async (req, res) => {
  try {
    const predResponse = await predictAndLog(req.params.ticker);
    const tr = await getTrackRecord(predResponse.ticker);
    const text = explain(predResponse, tr);
    res.json({ ticker: predResponse.ticker, answer: text });
  } catch (err) {
    handleForecastError(err, res);
  }
});

router.get("/predict/:ticker/event", async (req, res) => {
  try {
    const event = await getEventSignal(req.params.ticker, req.query.companyContext || "");
    if (!event) {
      return res.json({ ticker: req.params.ticker.toUpperCase(), eventFound: false });
    }
    res.json({ ticker: req.params.ticker.toUpperCase(), eventFound: true, ...event, disclaimer: DISCLAIMER });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/track-record", async (req, res) => {
  const ticker = req.query.ticker ? req.query.ticker.toUpperCase() : null;
  const tr = await getTrackRecord(ticker);
  res.json(tr);
});

router.get("/predictions", async (req, res) => {
  const { ticker, limit = 50 } = req.query;
  const rows = await prisma.forecastPrediction.findMany({
    where: ticker ? { ticker: ticker.toUpperCase() } : undefined,
    orderBy: { createdAt: "desc" },
    take: Number(limit),
  });
  res.json(
    rows.map((r) => ({
      id: r.id,
      ticker: r.ticker,
      createdAt: r.createdAt.toISOString(),
      technicalDirection: r.technicalDirection,
      technicalConfidence: Number(r.technicalConfidence),
      technicalBasis: r.technicalBasis,
      nSamples: r.nSamples,
      predictedLow: Number(r.predictedLow),
      predictedHigh: Number(r.predictedHigh),
      priceAtPrediction: Number(r.priceAtPrediction),
      targetDate: r.targetDate.toISOString(),
      outcomeChecked: r.outcomeChecked,
      actualPrice: r.actualPrice != null ? Number(r.actualPrice) : null,
      directionCorrect: r.directionCorrect,
      priceErrorPct: r.priceErrorPct != null ? Number(r.priceErrorPct) : null,
    }))
  );
});

// Call this nightly via an external cron (e.g. a Render Cron Job). Verifies
// matured predictions against reality.
router.post("/check-outcomes", async (req, res) => {
  const checked = await checkMaturedPredictions();
  res.json({ newlyChecked: checked.length, ids: checked.map((p) => p.id) });
});

// --- Watchlist ---

router.get("/watchlist", async (req, res) => {
  const items = await prisma.forecastWatchlistItem.findMany();
  res.json(items.map((w) => ({ ticker: w.ticker, displayName: w.displayName, alertThreshold: Number(w.alertThreshold) })));
});

router.post("/watchlist/:ticker", async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const existing = await prisma.forecastWatchlistItem.findUnique({ where: { ticker } });
  if (existing) return res.json({ status: "already exists" });

  await prisma.forecastWatchlistItem.create({
    data: {
      ticker,
      displayName: req.body?.displayName ?? null,
      alertThreshold: req.body?.alertThreshold ?? 65.0,
    },
  });
  res.json({ status: "added", ticker });
});

router.delete("/watchlist/:ticker", async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const existing = await prisma.forecastWatchlistItem.findUnique({ where: { ticker } });
  if (!existing) return res.status(404).json({ error: "Not in watchlist" });
  await prisma.forecastWatchlistItem.delete({ where: { ticker } });
  res.json({ status: "removed" });
});

// --- Screener ---

router.get("/screener/scan", async (req, res) => {
  const minConfidence = req.query.minConfidence ? Number(req.query.minConfidence) : 60.0;
  const result = await scanUniverse({ minConfidence });
  res.json(result);
});

router.get("/screener/universe", (req, res) => {
  res.json({ tickers: DEFAULT_UNIVERSE });
});

// Runs predictions across the whole watchlist in one call — this is what a
// nightly scheduled job hits. Returns which ones crossed each item's
// alertThreshold (worth surfacing to the client/broker).
router.post("/scan-watchlist", async (req, res) => {
  const items = await prisma.forecastWatchlistItem.findMany();
  const results = [];
  const alerts = [];

  for (const item of items) {
    try {
      const r = await predictAndLog(item.ticker);
      results.push(r);
      if (r.technicalConfidence >= Number(item.alertThreshold) && r.technicalDirection !== "neutral") {
        alerts.push(r);
      }
    } catch (err) {
      results.push({ ticker: item.ticker, error: err.message });
    }
  }

  res.json({ results, alerts });
});

module.exports = router;
