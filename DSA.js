// LOCAL DEV SERVER ONLY.  ->  node DSA.js  ->  http://localhost:3000
//
// In production (Vercel) this file is NOT used. Vercel serves /public as a
// static site and runs /api/chat.js as a serverless function.
// This server just reproduces that locally: static files + the same handler.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import chatHandler from "./api/chat.js";

// Load .env for local dev (Node 20.6+). Harmless if the file is missing.
try {
  process.loadEnvFile(fileURLToPath(new URL("./.env", import.meta.url)));
} catch {
  /* no .env - rely on real environment variables */
}

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/* ---- static files ---- */
async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = normalize(join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(normalize(PUBLIC_DIR))) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}

/* ---- adapt Node's req/res to the Vercel handler shape ---- */
function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on("end", () => resolve(raw));
    req.on("error", () => resolve(""));
  });
}

async function runChat(req, res) {
  const raw = await readBody(req);
  try {
    req.body = raw ? JSON.parse(raw) : {};
  } catch {
    req.body = {};
  }
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
    return res;
  };
  await chatHandler(req, res);
}

/* ---- server ---- */
createServer((req, res) => {
  if (req.url === "/api/chat") return void runChat(req, res);
  if (req.method === "GET") return void serveStatic(req, res);
  res.writeHead(405, { "Content-Type": "text/plain" }).end("Method not allowed");
}).listen(PORT, () => {
  console.log(`DSA_ChatBot (dev) running at http://localhost:${PORT}`);
});
