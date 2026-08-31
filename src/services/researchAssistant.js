const axios = require("axios");
const Anthropic = require("@anthropic-ai/sdk");
const prisma = require("../db/prisma");
const { notifyBrokerDigest } = require("./notificationService");

/**
 * Layer 2 — AI research assistant for the broker. Continuous (per scan
 * pass), not on-demand: pulls recent market news, runs a three-role
 * analysis per article (bull case / bear case / risk-supervisor verdict),
 * and surfaces only what's actually worth a broker's attention as a
 * batched digest — not one push per article.
 *
 * Deliberately NOT "one model straight to a confidence number" — a single
 * model asked directly for a confidence score is prone to hallucinated
 * conviction or chasing a false trend (per the multi-agent trading-research
 * literature this was built against). Splitting bull/bear/risk-supervisor
 * into one prompt's roles is the lightweight version of that pattern; a
 * true multi-call multi-agent debate is future work if this proves too
 * blunt in practice.
 *
 * UNIFIED with saaf-signal-backend's forecast engine, but not merged into
 * it: when an article names a specific, resolvable ticker, this module
 * calls that service's read-only `GET /signal/{ticker}` (safe to call
 * anytime, never logs a tracked prediction — see that repo's main.py) and
 * stores its technical_confidence/technical_direction/n_samples alongside
 * this module's own news-based confidenceTag, as separate fields, never
 * blended into one number. The two engines answer different questions —
 * "does this news matter" vs. "does history favor this direction" — and
 * showing both, explicitly separate, is more honest than pretending
 * there's one true confidence score. See `fetchForecastSignal` below.
 *
 * HONEST GAPS — not run against a real news feed, Anthropic account, or a
 * live saaf-signal-backend deployment yet:
 *   1. No in-process scheduler. This module is meant to be triggered by an
 *      external cron hitting POST /research/scan (see src/routes/research.js)
 *      — same pattern as saaf-signal-backend's scheduler.py hitting
 *      /check-outcomes and /scan-watchlist. Deploy platforms differ too much
 *      to bake a scheduler in here; wire up a Render/Railway Cron Job (or
 *      equivalent) against that route.
 *   2. NEWS_API_KEY targets a generic NewsAPI.org-shaped endpoint
 *      (`{ articles: [{ title, description, url }] }`). No licensed
 *      India-specific market news source is wired up — swap
 *      NEWS_API_BASE_URL/parsing for whatever source the business
 *      actually licenses before relying on this for real coverage.
 *   3. No rate limiting or cost cap on the Anthropic calls — a large
 *      pageSize on a busy news day means that many LLM calls, unmetered.
 *   4. Ticker extraction is LLM-guessed from the article text (e.g.
 *      "Reliance" -> "RELIANCE.NS") — it can miss, guess the wrong listed
 *      entity, or format it in a way saaf-signal-backend's data source
 *      (yfinance-style tickers, per that repo's README) doesn't recognize.
 *      A failed/unresolved lookup just means the row has no technical_*
 *      fields — never blocks the news-only analysis from being saved.
 *   5. SAAF_SIGNAL_API_BASE unset = the cross-check is silently skipped for
 *      every article, not an error — same "optional enrichment, not a hard
 *      dependency" posture as the rest of this module's external calls.
 */

const NEWS_API_KEY = process.env.NEWS_API_KEY;
const NEWS_API_BASE_URL = process.env.NEWS_API_BASE_URL || "https://newsapi.org/v2/everything";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_RESEARCH_MODEL || "claude-opus-5";
const SAAF_SIGNAL_API_BASE = process.env.SAAF_SIGNAL_API_BASE;

async function fetchMarketNews({ query, pageSize }) {
  if (!NEWS_API_KEY) {
    throw new Error("NEWS_API_KEY not configured — cannot scan news yet");
  }
  const response = await axios.get(NEWS_API_BASE_URL, {
    params: { q: query, pageSize, sortBy: "publishedAt", language: "en" },
    headers: { "X-Api-Key": NEWS_API_KEY },
    timeout: 15000,
  });
  return response.data?.articles || [];
}

/**
 * Cross-checks one ticker against saaf-signal-backend's own honest
 * confidence engine. Read-only endpoint (GET /signal/{ticker}) — safe to
 * call for every article, never logs a tracked prediction on that side.
 * Returns null (not a throw) on any failure or when unconfigured — this is
 * an optional enrichment, a missing/failed cross-check must never stop the
 * news-only analysis from being saved.
 */
async function fetchForecastSignal(ticker) {
  if (!SAAF_SIGNAL_API_BASE || !ticker) return null;
  try {
    const response = await axios.get(`${SAAF_SIGNAL_API_BASE}/signal/${encodeURIComponent(ticker)}`, {
      timeout: 15000,
    });
    const data = response.data;
    return {
      technicalDirection: data.technical_direction ?? null,
      technicalConfidence: data.technical_confidence ?? null,
      technicalSampleSize: data.n_samples ?? null,
      technicalReliabilityTier: data.reliability_tier ?? null,
    };
  } catch (err) {
    console.error(`Forecast cross-check failed for ticker "${ticker}":`, err.message);
    return null;
  }
}

let anthropicClient = null;
function getAnthropicClient() {
  // Anthropic() resolves credentials itself (ANTHROPIC_API_KEY, or an `ant
  // auth login` profile) — only skip if we already know neither is set.
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropicClient) anthropicClient = new Anthropic();
  return anthropicClient;
}

const ANALYSIS_SYSTEM_PROMPT = `You are analyzing one news headline/snippet for its potential impact on Indian equity markets, from three roles at once: a BULL case, a BEAR case, and a RISK-SUPERVISOR verdict that reconciles them into one honest read.

Rules:
- Ground every claim in the article text given — never invent facts not in it.
- confidenceTag must be one of LOW, MEDIUM, HIGH. Default to LOW whenever the article is vague, speculative, or lacks concrete numbers/facts. Only use HIGH when the article contains specific, verifiable, market-moving facts (actual earnings numbers, a confirmed regulatory action, a signed deal) — not general sentiment or speculation.
- If the article has no plausible link to a specific sector or stock, set "sector" to null and keep both cases short.
- ticker: if the article clearly names ONE specific NSE-listed company, give its Yahoo Finance-style ticker (e.g. "RELIANCE.NS", "TCS.NS"). If it names multiple companies, an unlisted/foreign company, or only a sector/index in general, set ticker to null — do not guess.
- Output ONLY a JSON object, no other text, in exactly this shape:
{"sector": string|null, "ticker": string|null, "bullCase": string, "bearCase": string, "riskNote": string, "confidenceTag": "LOW"|"MEDIUM"|"HIGH"}`;

async function analyzeArticle(article) {
  const client = getAnthropicClient();
  if (!client) {
    throw new Error("ANTHROPIC_API_KEY not configured — cannot analyze news yet");
  }

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    system: ANALYSIS_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Headline: ${article.title}\n\nSnippet: ${article.description || "(none)"}`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock) throw new Error("Anthropic response had no text block");

  // Model is instructed to return raw JSON; strip code fences defensively
  // in case it wraps the response anyway. json.loads()-equivalent, never
  // string-matched.
  const raw = textBlock.text.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(raw);
}

/**
 * One full scan pass. Every analyzed article is persisted, even at LOW
 * confidence — the audit trail doesn't get to be selective. Only
 * MEDIUM/HIGH items go into the broker's batched WhatsApp digest; LOW ones
 * stay dashboard-only, so the broker isn't paged for noise.
 */
async function runScan({ groupId, query = "NSE OR BSE OR Nifty OR Sensex", pageSize = 10 }) {
  const articles = await fetchMarketNews({ query, pageSize });

  const analyzed = [];
  for (const article of articles) {
    try {
      const analysis = await analyzeArticle(article);
      const forecast = await fetchForecastSignal(analysis.ticker);
      const saved = await prisma.researchSignal.create({
        data: {
          groupId: groupId ?? null,
          headline: article.title,
          sourceUrl: article.url ?? null,
          sector: analysis.sector ?? null,
          bullCase: analysis.bullCase,
          bearCase: analysis.bearCase,
          riskNote: analysis.riskNote,
          confidenceTag: analysis.confidenceTag,
          ticker: analysis.ticker ?? null,
          technicalDirection: forecast?.technicalDirection ?? null,
          technicalConfidence: forecast?.technicalConfidence ?? null,
          technicalSampleSize: forecast?.technicalSampleSize ?? null,
          technicalReliabilityTier: forecast?.technicalReliabilityTier ?? null,
        },
      });
      analyzed.push(saved);
    } catch (err) {
      console.error(`Research scan: failed to analyze "${article.title}":`, err.message);
    }
  }

  const noteworthy = analyzed.filter((a) => a.confidenceTag !== "LOW");
  if (groupId && noteworthy.length > 0) {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    const digest = noteworthy
      .map((a) => {
        // Two separate readings, shown separately, never blended — the
        // news verdict is what triggered the flag, the technical line (if
        // present) is a second, independent opinion, not a "combined score".
        const technicalLine = a.technicalConfidence
          ? `\nHistorical read: ${a.technicalDirection} @ ${a.technicalConfidence}% confidence (${a.technicalSampleSize} samples, ${a.technicalReliabilityTier})`
          : "";
        return `[${a.confidenceTag}] ${a.sector || "General"}${a.ticker ? ` (${a.ticker})` : ""}: ${a.headline}\n${a.riskNote}${technicalLine}`;
      })
      .join("\n\n");
    await notifyBrokerDigest({
      groupId,
      message: `Research digest — ${noteworthy.length} flagged item(s):\n\n${digest}`,
      whatsappNumber: group?.brokerWhatsappNumber ?? null,
    });
  }

  return { scanned: articles.length, analyzed: analyzed.length, noteworthy: noteworthy.length };
}

module.exports = { runScan, analyzeArticle, fetchMarketNews, fetchForecastSignal };
