// Vercel serverless function  ->  POST /api/chat
// Streams the model reply as plain text. DSA.js is the local dev server.

import { GoogleGenAI } from "@google/genai";

/* ------------------------------------------------------------------ config */

// GEMINI_API_KEY must be set as an environment variable.
//   Vercel:  Project -> Settings -> Environment Variables
//   Local:   put it in a .env file (see .env.example) or export it in your shell
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const SYSTEM_INSTRUCTION = `You are a Data Structure and Algorithm instructor. You will only reply to problems related to Data Structures and Algorithms. You have to solve the user's query in the simplest way possible, with clear steps, complexity analysis, and short code examples when helpful.
If the user asks any question which is not related to Data Structures and Algorithms, refuse politely and creatively (do not use the exact same wording every time). For example, if the user asks "how are you", reply with something in the spirit of: "I am not designed to answer these types of questions - I can only help you with your DSA queries." Keep that refusal varied and friendly.`;

const MAX_ATTEMPTS = 3;
const HISTORY_TURNS = 8; // cap context sent to the model (fewer tokens = fewer 429s)

/* ---------------------------------------------------------------- helpers */

let _ai = null;
function getAi() {
  if (_ai) return _ai;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  _ai = new GoogleGenAI({ apiKey: key });
  return _ai;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gemini errors sometimes carry  "retryDelay": "3s"  -- honour it, tightly capped
// (the serverless function only has ~60s total).
function retryDelayMs(err, fallback) {
  const m = String(err?.message || err).match(/retryDelay"?:\s*"?(\d+(?:\.\d+)?)s/i);
  if (m) return Math.min(Number(m[1]) * 1000 + 250, 8000);
  return fallback;
}

// Daily free-tier quota is exhausted -> retrying today is pointless.
function isDailyQuota(err) {
  const s = String(err?.message || err).toLowerCase();
  return (
    /resource_exhausted|perday|per.?day|free_tier|exceeded your current quota/.test(
      s
    )
  );
}

// transient = worth retrying (overload / brief rate spike / 5xx / timeout)
function isTransient(err) {
  const s = (
    String(err?.status || "") +
    " " +
    String(err?.code || "") +
    " " +
    String(err?.message || err)
  ).toLowerCase();
  return (
    /\b(500|502|503|504)\b/.test(s) ||
    /overload|unavailable|internal error|deadline|timeout|try again/.test(s)
  );
}

function toContents(history, message) {
  const turns = (Array.isArray(history) ? history : [])
    .filter((t) => t && t.text)
    .slice(-HISTORY_TURNS);

  const contents = turns.map((t) => ({
    role: t.role === "assistant" || t.role === "model" ? "model" : "user",
    parts: [{ text: String(t.text) }],
  }));
  contents.push({ role: "user", parts: [{ text: String(message) }] });
  return contents;
}

/* --------------------------------------------------------------- handler */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ai = getAi();
  if (!ai) {
    return res
      .status(500)
      .json({ error: "GEMINI_API_KEY is not set on the server." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  const message = (body.message || "").toString().trim();
  if (!message) {
    return res.status(400).json({ error: "Field 'message' is required." });
  }

  const params = {
    model: MODEL,
    contents: toContents(body.history, message),
    config: { systemInstruction: SYSTEM_INSTRUCTION },
  };

  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const stream = await ai.models.generateContentStream(params);

      let started = false;
      for await (const chunk of stream) {
        const text = chunk?.text;
        if (!text) continue;
        if (!started) {
          started = true;
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Accel-Buffering", "no");
          res.flushHeaders?.();
        }
        res.write(text);
      }

      if (!started) {
        // model returned nothing usable
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.write("");
      }
      return res.end();
    } catch (err) {
      lastErr = err;

      // Already streaming bytes -> can't retry or switch to JSON. Just close.
      if (res.headersSent || res.writableEnded) {
        console.error("Gemini stream broke mid-response:", err?.message || err);
        try {
          res.end();
        } catch {}
        return;
      }

      const daily = isDailyQuota(err);
      const transient = !daily && isTransient(err);
      console.error(
        `Gemini error (attempt ${attempt}/${MAX_ATTEMPTS}, daily=${daily}, transient=${transient}):`,
        err?.message || err
      );

      if (daily) break; // a per-day quota won't clear within this request
      if (transient && attempt < MAX_ATTEMPTS) {
        await sleep(retryDelayMs(err, 800 * attempt));
        continue;
      }
      break;
    }
  }

  const daily = isDailyQuota(lastErr);
  return res.status(daily ? 429 : 502).json({
    error: daily
      ? "The Gemini API key's free-tier daily limit is used up (about 20 requests/day). It resets around midnight US-Pacific. To lift it, enable billing on the key or use a paid key."
      : "The model is busy right now. Please try again in a moment.",
    detail: String(lastErr?.message || lastErr),
  });
}
