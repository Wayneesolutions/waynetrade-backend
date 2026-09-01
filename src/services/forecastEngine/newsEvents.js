const Parser = require("rss-parser");
const Anthropic = require("@anthropic-ai/sdk");

/**
 * The event/news layer — Iran-war-oil-prices style structural patterns vs.
 * movie-release-stock-hype style speculative patterns, for ONE specific
 * ticker on demand. Kept STRICTLY separate from the technical model's
 * output (forecast.js) — never blended into one score. This answers a
 * different question ("is there a notable event here, and is it a
 * well-precedented pattern") than Layer 2's own general market-news scan
 * (researchAssistant.js), which is broker-facing and not ticker-scoped.
 *
 * HONEST GAP: this sandbox's egress proxy blocks both the RSS feed hosts
 * below and api.anthropic.com's usual path — never exercised end-to-end
 * here. The classification prompt logic is a direct port of the original
 * Python version; confirm a real run once deployed somewhere with normal
 * internet access and ANTHROPIC_API_KEY set.
 */

const NEWS_FEEDS = [
  "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
  "https://feeds.reuters.com/reuters/businessNews",
];

// Patterns considered "structural" (well-established historical
// relationship) vs everything else, which defaults to "speculative" unless
// the LLM has strong reason to say otherwise. Deliberately conservative.
const STRUCTURAL_PATTERNS = [
  "oil supply disruption", "interest rate change", "central bank policy",
  "currency devaluation", "war affecting energy/trade routes",
  "regulatory/tax policy change", "earnings report", "credit rating change",
];

const parser = new Parser();

async function fetchRecentHeadlines(keywords, { maxItems = 15, hoursBack = 48 } = {}) {
  const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
  const matched = [];

  for (const feedUrl of NEWS_FEEDS) {
    let feed;
    try {
      feed = await parser.parseURL(feedUrl);
    } catch {
      continue;
    }
    for (const entry of (feed.items || []).slice(0, 50)) {
      const title = entry.title || "";
      const summary = entry.contentSnippet || entry.summary || "";
      const text = `${title} ${summary}`.toLowerCase();
      if (keywords.some((kw) => text.includes(kw.toLowerCase()))) {
        matched.push({ title, summary, link: entry.link || "" });
      }
      if (matched.length >= maxItems) break;
    }
    if (matched.length >= maxItems) break;
  }
  return matched;
}

/**
 * Ask Claude to classify: is there a notable event here, is it a
 * structural (well-precedented) pattern or speculative, and what's the
 * plain-English summary. Returns null if no headlines were found (no
 * fabricated events) or the model says it isn't relevant.
 */
async function classifyEvent(ticker, companyContext, headlines) {
  if (headlines.length === 0) return null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Set ANTHROPIC_API_KEY to use the event/news layer.");
  }
  const client = new Anthropic();

  const headlinesText = headlines
    .slice(0, 10)
    .map((h) => `- ${h.title}: ${(h.summary || "").slice(0, 200)}`)
    .join("\n");

  const prompt = `You are a careful, honest financial news classifier. You are NOT predicting stock prices — you are only assessing whether recent news is relevant to a company, and if so, whether it matches a well-established historical pattern or is speculative/hype-driven.

Company/ticker: ${ticker}
Context: ${companyContext}

Recent headlines:
${headlinesText}

Known well-established structural patterns (only use "established pattern" if the event genuinely matches one of these, or an equally well-precedented pattern):
${STRUCTURAL_PATTERNS.join(", ")}

Respond ONLY with JSON, no other text, in this exact shape:
{"relevant": true or false, "event_summary": "one plain-English sentence describing the event, or null if not relevant", "direction": "bullish" or "bearish" or "uncertain", "confidence_label": "established pattern" or "speculative" or "unclear", "reasoning": "one sentence on why you labeled it this way"}

Be conservative. If you're not confident there's a real historical precedent, label it "speculative" or "unclear" rather than "established pattern". If the headlines don't clearly relate to this company, set relevant to false.`;

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_RESEARCH_MODEL || "claude-opus-5",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) return null;

  const raw = textBlock.text.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!result.relevant) return null;

  return {
    eventSummary: result.event_summary ?? null,
    eventDirection: result.direction ?? "uncertain",
    eventConfidenceLabel: result.confidence_label ?? "unclear",
  };
}

// Full pipeline: fetch headlines for this ticker's keywords, classify, return or null.
async function getEventSignal(ticker, companyContext = "") {
  const bareTicker = ticker.replace(/\.NS$/i, "").replace(/\.BO$/i, "");
  const keywords = [bareTicker, companyContext].filter(Boolean);
  const headlines = await fetchRecentHeadlines(keywords);
  return classifyEvent(ticker, companyContext, headlines);
}

module.exports = { getEventSignal, fetchRecentHeadlines, classifyEvent };
