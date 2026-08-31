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
 * HONEST GAPS — not run against a real news feed or Anthropic account yet:
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
 */

const NEWS_API_KEY = process.env.NEWS_API_KEY;
const NEWS_API_BASE_URL = process.env.NEWS_API_BASE_URL || "https://newsapi.org/v2/everything";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_RESEARCH_MODEL || "claude-opus-5";

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
- Output ONLY a JSON object, no other text, in exactly this shape:
{"sector": string|null, "bullCase": string, "bearCase": string, "riskNote": string, "confidenceTag": "LOW"|"MEDIUM"|"HIGH"}`;

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
      .map((a) => `[${a.confidenceTag}] ${a.sector || "General"}: ${a.headline}\n${a.riskNote}`)
      .join("\n\n");
    await notifyBrokerDigest({
      groupId,
      message: `Research digest — ${noteworthy.length} flagged item(s):\n\n${digest}`,
      whatsappNumber: group?.brokerWhatsappNumber ?? null,
    });
  }

  return { scanned: articles.length, analyzed: analyzed.length, noteworthy: noteworthy.length };
}

module.exports = { runScan, analyzeArticle, fetchMarketNews };
