# CLAUDE.md

Guidance for working in this repo. See `README.md` for full architecture and
deploy details.

## What this is

A single-page tool: upload two images → POST to an n8n webhook → display the
returned image. Decathlon-styled UI (placeholder design, restyle freely). No
framework, no build step — plain HTML/CSS/JS plus one serverless function.

## Critical: this is its own git repo

`app_frontend/` has its **own** `.git`. The parent folder
(`vibe_coding/`) is a separate monorepo (`finance/`, `snake_game/`) that
**ignores** this directory. Run all git commands from inside `app_frontend/`.
Never commit to the parent on behalf of this project.

## Security model (do not break)

The browser must **never** see the real webhook URL.

- The client (`app.js`) only ever calls the same-origin proxy `/api/generate`.
- `api/generate.js` (Vercel Edge handler) holds the URL via `process.env.WEBHOOK_URL`
  and forwards the request. The secret lives only in `.env.local` (local,
  gitignored) and Vercel env vars (prod).
- Do **not** hardcode the webhook URL anywhere in client code or commit it.
- Keep validation on **both** sides: type allowlist (JPG/PNG/WEBP), 10 MB cap,
  exactly two files; verify the response is `image/*` before rendering.
- `index.html` has **no inline `<script>`/`<style>`** on purpose — the strict CSP
  in `vercel.json` forbids inline scripts. Keep JS in `app.js`, CSS in
  `styles.css`. If you add inline code you must loosen the CSP (avoid this).

## Layout

- `index.html` — markup only; links `styles.css` + `app.js`.
- `styles.css` — theme via CSS variables (`--dkt-blue`, `--dkt-yellow`, …).
- `app.js` — previews, client validation, fetch to `/api/generate`.
- `api/generate.js` — Edge proxy: validates, forwards, validates response.
- `dev-server.mjs` — local server that runs the real proxy (no Vercel CLI).
- `vercel.json` — security headers. `package.json` — `"type":"module"`, scripts.

## Run locally

```bash
cp .env.example .env.local   # set WEBHOOK_URL
node dev-server.mjs          # http://localhost:3000 (UI + real proxy)
```

A static-only server (`python -m http.server`) serves the UI but `/api/generate`
will 404 → generation fails. Use `dev-server.mjs` or `vercel dev`.

## Gotcha: empty upstream responses

The n8n webhook sometimes returns `200` + `application/json` + empty body
(content-length 0) — typically the AI image node is out of quota or hit a
filter. That's **upstream**, not a bug here. The proxy correctly rejects it
(502 → generic UI error). Confirm by calling the webhook directly with `curl`
before changing app code.

## Conventions

- Match existing code style; keep the comment blocks/section banners.
- Commit only when asked. End commit messages with the Co-Authored-By trailer.
