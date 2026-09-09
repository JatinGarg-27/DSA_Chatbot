// Vercel serverless function  ->  POST /api/chat
// This is what runs in production. DSA.js is only the local dev server.

import { GoogleGenAI } from "@google/genai";

/* ------------------------------------------------------------------ config */

// GEMINI_API_KEY must be set as an environment variable.
//   Vercel:  Project -> Settings -> Environment Variables
//   Local:   put it in a .env file (see .env.example) or export it in your shell
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const SYSTEM_INSTRUCTION = `You are a Data Structure and Algorithm instructor. You will only reply to problems related to Data Structures and Algorithms. You have to solve the user's query in the simplest way possible, with clear steps, complexity analysis, and short code examples when helpful.
If the user asks any question which is not related to Data Structures and Algorithms, refuse politely and creatively (do not use the exact same wording every time). For example, if the user asks "how are you", reply with something in the spirit of: "I am not designed to answer these types of questions - I can only help you with your DSA queries." Keep that refusal varied and friendly.`;

/* ---------------------------------------------------------------- helpers */

// Built lazily and reused across invocations. Reading the key at call time
// means a .env loaded by the dev server after import still works.
let _ai = null;
function getAi() {
  if (_ai) return _ai;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  _ai = new GoogleGenAI({ apiKey: key });
  return _ai;
}

function toContents(history, message) {
  const contents = [];
  for (const turn of Array.isArray(history) ? history : []) {
    if (!turn || !turn.text) continue;
    contents.push({
      role: turn.role === "assistant" || turn.role === "model" ? "model" : "user",
      parts: [{ text: String(turn.text) }],
    });
  }
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

  // Vercel usually parses JSON bodies, but be defensive.
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

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: toContents(body.history, message),
      config: { systemInstruction: SYSTEM_INSTRUCTION },
    });

    return res.status(200).json({ reply: response.text ?? "" });
  } catch (err) {
    console.error("Gemini error:", err);
    return res.status(502).json({
      error: "The model request failed. Check GEMINI_API_KEY / model id.",
      detail: String(err?.message || err),
    });
  }
}
