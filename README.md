# DSA Instructor — AI Chatbot

A minimal chatbot that answers **Data Structures & Algorithms** questions only.
Ask about arrays, trees, graphs, recursion, sorting, or complexity in plain
language and get a step-by-step explanation with short code. Anything off-topic
is politely refused.

Built with a vanilla HTML/CSS/JS frontend and a small Node serverless function
that talks to the Google **Gemini** API. Replies **stream in live** as they are
generated.

## Live demo

**https://dsachatbot.vercel.app**

Current build: https://dsachatbot-89fju1d0p-jatin-98ef.vercel.app/

> This is the **vanilla JS** version (simple Vercel deployment).
> A **React** rewrite is planned — the live link above will be updated to point
> to it once it ships. See [Roadmap](#roadmap).

## Features

- Streaming responses (text appears as it is generated)
- DSA-only — refuses unrelated questions, with a varied reply each time
- Lightweight Markdown rendering (headings, lists, **bold**, fenced code blocks)
- Multi-turn context (recent history sent back with each question)
- Automatic retry on transient Gemini errors; clear messages for auth / quota
  failures
- No frontend framework, no build step

## Tech stack

| Layer | What |
|------|------|
| Frontend | Static `public/` — `index.html`, `style.css`, `script.js` |
| Backend | `api/chat.js` — Vercel serverless function (`POST /api/chat`) |
| Model | Google Gemini via `@google/genai` (`gemini-3.6-flash` by default) |
| Hosting | Vercel (static + serverless function) |
| Local dev | `DSA.js` — tiny Node HTTP server that serves `public/` and reuses `api/chat.js` |

## Project structure

```
.
├── api/
│   └── chat.js          # serverless function: POST /api/chat -> Gemini (streaming)
├── public/
│   ├── index.html
│   ├── style.css
│   └── script.js        # chat UI + stream reader + markdown rendering
├── DSA.js               # local dev server only (not used in production)
├── vercel.json          # function config (maxDuration)
├── .env.example         # copy to .env for local dev
└── package.json
```

## Run locally

Requires **Node 20.6+**.

```bash
git clone https://github.com/JatinGarg-27/DSA_Chatbot.git
cd DSA_Chatbot
npm install

cp .env.example .env        # then edit .env and add your key
npm start                   # -> http://localhost:3000
```

## Environment variables

| Name | Required | Default | Notes |
|------|----------|---------|-------|
| `GEMINI_API_KEY` | yes | — | Google AI Studio API key |
| `GEMINI_MODEL` | no | `gemini-3.6-flash` | Any Gemini model your key can access |

Set them in a local `.env` file, or in **Vercel → Settings → Environment
Variables** for the deployment.

## Deploy your own (Vercel)

1. Fork / push this repo to GitHub.
2. Vercel → **Add New → Project → Import** the repo. Leave all build settings
   default (framework: Other, no build command, root `./`).
3. Add the `GEMINI_API_KEY` environment variable.
4. Deploy. `vercel.json` handles the rest.

## Notes / limitations

- The Gemini **free tier** allows roughly **20 requests/day** for
  `gemini-3.6-flash`. After that, requests return a "daily limit" error until it
  resets (~midnight US-Pacific). Enable billing on the API key to lift this, or
  set `GEMINI_MODEL` to a model with a larger free quota.
- `gemini-3.6-flash` is a reasoning model, so a full answer can take 10–30s —
  streaming keeps the reply visibly progressing while it works.
- API responses can be imperfect; verify any code before relying on it.

## Roadmap

| Version | Frontend | Status | Link |
|---------|----------|--------|------|
| v1 | Vanilla HTML/CSS/JS | ✅ Live | https://dsachatbot.vercel.app |
| v2 | React | 🔜 Planned | _to be added_ |

The React version will reuse the same `api/chat.js` backend; only the `public/`
UI is replaced. This README and the live link will be updated when it is
deployed.
