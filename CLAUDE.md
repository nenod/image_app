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

## Auth (Supabase) — what's a secret and what isn't

- Email/password accounts via Supabase Auth. **Login is required**: `auth-ui.js`
  redirects to `login.html` when there's no valid session and reveals
  `index.html` (removes `body.gated`) only once signed in. The gate is
  client-side only — it protects the UI, not `/api/generate`.
- `auth.js` calls the Supabase Auth REST API directly with `fetch` — **no SDK,
  no CDN**, so `script-src 'self'` stays strict. The only CSP allowance is the
  Supabase origin in `connect-src`.
- The Supabase URL + **publishable** key in `auth-config.js` are **public by
  design** — unlike `WEBHOOK_URL`, they're meant to ship in the browser. Do not
  confuse them with the webhook secret; never put the webhook URL here.
- Instant login requires **"Confirm email" OFF** in the Supabase dashboard
  (manual step; no MCP tool for it). The UI also handles the confirm-on case.
- **Vercel:** auth needs **no env vars** (publishable key is public, in the
  repo). It works in prod as long as the deployed `vercel.json` keeps the
  Supabase origin in `connect-src` — `dev-server.mjs` doesn't enforce CSP, so
  prod is the first place a missing `connect-src` entry would break auth. The
  "Confirm email" toggle is project-global, so it applies to prod too.

## Paywall (Stripe subscription) — what's a secret and what isn't

- The app is paid: **$9.99/month**. Sign-up is free, but generating requires an
  **active subscription**. Entitlement is the boolean `public.profiles.paid` in
  Supabase, kept in sync with Stripe by the webhook (true iff `active`/`trialing`).
- **Two enforcement points share one check** — `lib/access.js` `fetchPaid(token)`
  reads `profiles.paid` via PostgREST under RLS (only the caller's row):
  - `auth-ui.js` redirects unpaid users to `pay.html` (UI gate).
  - **`api/generate.js` is the real boundary**: it now requires an
    `Authorization: Bearer <supabase access_token>` *and* `paid=true`, returning
    `401`/`402` otherwise. `app.js` attaches the token. Don't remove this — the
    UI gate alone does not protect the proxy.
- **`api/stripe-webhook.js`** verifies the Stripe signature with **Web Crypto
  HMAC-SHA256** (no Stripe SDK, no CDN — keeps `script-src 'self'`), then writes
  `profiles` with the **service-role** key. Handles `checkout.session.completed`
  (grant + persist customer/subscription ids), `customer.subscription.updated`
  (sync), `customer.subscription.deleted` + `invoice.payment_failed` (revoke).
  Later events are matched by the stored `stripe_subscription_id`.
- **Public vs secret (don't confuse them):** the Payment Link in `pay-config.js`
  is **public** by design (like the Supabase publishable key). The
  `STRIPE_WEBHOOK_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are **secrets** — env
  vars only (`.env.local` / Vercel), never committed, never shipped to the browser.
- **RLS:** `profiles` has only a `select`-own-row policy; no client insert/update.
  The webhook (service role) bypasses RLS; a SECURITY DEFINER trigger
  (`handle_new_user`) creates the row on sign-up. `EXECUTE` on that function is
  revoked from `anon`/`authenticated` (it's trigger-only).
- **Mapping:** the client appends `?client_reference_id=<supabase uid>` to the
  Payment Link so the first webhook event maps the subscription to the user.
- **Vercel:** needs `STRIPE_WEBHOOK_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` env
  vars **and** a registered Stripe webhook endpoint pointing at
  `/api/stripe-webhook` (Stripe can't reach `localhost` — use `stripe listen`
  for local end-to-end). No CSP change was needed: the Payment Link is a
  top-level navigation to `buy.stripe.com`, not a `fetch`.

## Layout

- `index.html` — markup only; links `styles.css` + `app.js` + `auth-ui.js`.
- `styles.css` — theme via CSS variables (`--dkt-blue`, `--dkt-yellow`, …).
- `app.js` — previews, client validation, fetch to `/api/generate`.
- `api/generate.js` — Edge proxy: validates, forwards, validates response.
- `login.html` / `login.js` — email + password sign-up / log-in page.
- `auth.js` — Supabase Auth helpers (REST, no SDK); `auth-config.js` — public keys.
- `auth-ui.js` — header account control + login/subscription gate on `index.html`.
- `lib/access.js` — shared `fetchPaid(token)` (RLS-scoped `profiles.paid` read).
- `pay.html` / `pay.js` — "subscribe to continue" page; opens the Payment Link.
- `pay-config.js` — **public** Stripe Payment Link URL.
- `api/stripe-webhook.js` — Edge webhook: HMAC-verify + sync `profiles.paid`.
- `dev-server.mjs` — local server that runs the real proxies (no Vercel CLI).
- `vercel.json` — security headers. `package.json` — `"type":"module"`, scripts.

## Run locally

```bash
cp .env.example .env.local   # set WEBHOOK_URL, STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY
node dev-server.mjs          # http://localhost:3000 (UI + real proxies)
# For real Stripe→webhook locally (Stripe can't reach localhost):
# stripe listen --forward-to localhost:3000/api/stripe-webhook
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
