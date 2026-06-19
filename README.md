# Generator slika — two-image webhook generator

Upload two images, send them to an n8n webhook for processing, and display the
generated image that comes back. Styled after a Decathlon product page.

## Architecture (and why)

```
Browser (index.html + app.js)
        │  POST multipart/form-data  → /api/generate   (same origin)
        ▼
Serverless proxy (api/generate.js, Vercel Edge)
        │  holds WEBHOOK_URL from the environment (never sent to the browser)
        │  validates files, forwards the request
        ▼
n8n webhook  →  returns a binary image  →  streamed back to the browser
```

The browser **never** sees the real webhook URL. It only talks to our own
same-origin `/api/generate` endpoint. The secret lives server-side in the
`WEBHOOK_URL` environment variable.

> A client-side `.env` alone cannot hide the URL: any value injected into
> browser JS ends up in the shipped bundle and is readable in DevTools. The
> serverless proxy is what actually keeps it secret.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup only (no inline script/style, so CSP can be strict) |
| `styles.css` | All styling (generator + auth page + header account control) |
| `app.js` | Client logic: previews, validation, calls `/api/generate` |
| `api/generate.js` | Edge serverless proxy that holds the secret and validates input |
| `login.html` / `login.js` | Email + password sign-up / log-in page |
| `auth.js` | Supabase Auth helpers (sign up / in / out, session, refresh) |
| `auth-ui.js` | Header account control + the login **and subscription** gate on `index.html` |
| `auth-config.js` | **Public** Supabase URL + publishable key (safe to commit) |
| `lib/access.js` | Shared `fetchPaid(token)` — reads `profiles.paid` under RLS (used by the gate **and** the proxy) |
| `pay.html` / `pay.js` | "Subscribe to continue" page; opens the Stripe Payment Link |
| `pay-config.js` | **Public** Stripe Payment Link URL (safe to commit) |
| `api/stripe-webhook.js` | Edge webhook: verifies the Stripe signature, syncs `profiles.paid` |
| `vercel.json` | Security headers (CSP, HSTS, nosniff, frame/clickjacking, etc.) |
| `dev-server.mjs` | Local dev server that runs the real proxies without the Vercel CLI |
| `.env.example` | Template for the required env vars (webhook URL + paywall secrets) |

## Authentication (Supabase)

Email + password accounts via [Supabase Auth](https://supabase.com/auth).
**Login is required** to use the generator: `auth-ui.js` redirects to
`login.html` when there is no valid session and only reveals `index.html` once
signed in (the page starts hidden via `body.gated` to avoid a content flash).
`login.html` lets a visitor sign up or log in; the header then shows their
email + a logout button.

- **No SDK / no build step.** `auth.js` calls the Supabase Auth REST API
  (`/auth/v1/...`) directly with `fetch`, so `script-src 'self'` stays strict.
  The only CSP change is adding the Supabase origin to `connect-src`
  (`vercel.json`).
- **The publishable key is public by design.** Unlike `WEBHOOK_URL`, the
  Supabase project URL + publishable key are meant to ship in the browser
  (`auth-config.js`); access is enforced by Supabase Auth / RLS, not key
  secrecy. Safe to commit.
- **Sessions** are stored in `localStorage` (`dkt-auth-session`) and the access
  token is silently refreshed when expired.

### One-time Supabase setup

For **instant login after signup**, disable email confirmation:
**Dashboard → Authentication → Sign In / Providers → Email → turn off
"Confirm email"**. Leave it on if you want users to verify via an email link
first (requires working SMTP); the UI handles both cases.

## Paywall (Stripe subscription)

The generator is paid: **$9.99/month**. A user can sign up for free, but must
hold an **active subscription** to generate.

```
Sign up ─► (DB trigger creates profiles row, paid=false) ─► gated → pay.html
pay.html ─► Stripe Payment Link (?client_reference_id=<uid>&prefilled_email=…)
Stripe subscription events ─► /api/stripe-webhook ─► profiles.paid = true / false
index.html + /api/generate ─► allowed only while profiles.paid = true
```

- **Entitlement** lives in Supabase `public.profiles.paid`, a boolean that
  mirrors the live Stripe subscription status (true iff `active`/`trialing`).
  **RLS** lets each user read only their own row; only the DB trigger and the
  service-role webhook can write it (clients cannot self-grant access).
- **Two enforcement points, same check** (`lib/access.js` → `fetchPaid`):
  - `auth-ui.js` redirects unpaid users to `pay.html` (UI/UX).
  - **`api/generate.js` requires a valid Supabase JWT *and* `paid=true`**
    (`401`/`402` otherwise) — the real security boundary, so the API is
    protected even if the UI gate is bypassed. `app.js` sends the access token
    as a `Bearer` header.
- **`api/stripe-webhook.js`** verifies the Stripe signature with Web Crypto
  HMAC-SHA256 (no Stripe SDK → CSP stays strict), then updates `profiles` with
  the Supabase **service-role** key. It handles `checkout.session.completed`
  (grant + store customer/subscription ids), `customer.subscription.updated`
  (sync status), and `customer.subscription.deleted` / `invoice.payment_failed`
  (revoke).
- **Public vs secret:** the Payment Link (`pay-config.js`) is public like the
  Supabase keys. The webhook signing secret and the service-role key are
  **secrets** — env vars only (`STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`).

## Security measures

- **Secret isolation** — webhook URL (`WEBHOOK_URL`), Stripe signing secret
  (`STRIPE_WEBHOOK_SECRET`), and Supabase service-role key
  (`SUPABASE_SERVICE_ROLE_KEY`) live only in server-side env vars.
- **Server-enforced paywall** — `/api/generate` requires a valid Supabase JWT
  with `paid=true`; the Stripe webhook verifies an HMAC signature before any DB
  write. RLS prevents clients from granting themselves access.
- **Input validation (client + server)** — type allowlist (JPG/PNG/WEBP),
  10 MB/file size cap, non-empty, exactly two files. Server re-validates.
- **Output validation** — both proxy and client verify the response
  `Content-Type` is `image/*` before rendering.
- **Request hardening** — only `POST`; clean FormData rebuilt server-side;
  filenames sanitised; 2-minute timeouts; generic error messages (no internals
  leaked); `Cache-Control: no-store` on dynamic responses.
- **HTTP security headers** (`vercel.json`) — strict CSP with no inline scripts,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy`, HSTS.

## Local development

A plain static server (e.g. `python -m http.server`) can serve the UI but
**cannot** run `/api/generate`, so generation will fail. Use one of the options
below — both read `WEBHOOK_URL` from `.env.local`.

First, set up the env file:

```bash
cp .env.example .env.local   # then fill in the real values in .env.local
```

`.env.local` needs `WEBHOOK_URL` (generation), plus — for the paywall —
`STRIPE_WEBHOOK_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`. To exercise the real
Stripe → webhook flow locally, forward events to the local server with the
Stripe CLI (its printed `whsec_…` becomes your `STRIPE_WEBHOOK_SECRET`):

```bash
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

**Option A — bundled dev server (no account needed):**

```bash
node dev-server.mjs    # serves the site + the real proxy at http://localhost:3000
```

`dev-server.mjs` imports the actual `api/generate.js` handler, so local
behaviour matches production exactly.

**Option B — Vercel CLI (closest to production):**

```bash
npm i -g vercel        # one-time (or use: npx vercel ...)
vercel dev             # serves the site + /api/generate at http://localhost:3000
```

> `.env.local` is gitignored — never commit it.

## Troubleshooting

- **"Failed to generate image" with the proxy logging an empty / `application/json`
  upstream response:** the request reached n8n but the workflow returned no
  image. This is upstream, not the app — check the n8n execution log; the AI
  image node is usually out of quota or hit a content filter. The proxy
  deliberately rejects non-`image/*` responses rather than rendering them.

## Deploy (Vercel)

1. Push this folder to a Git repo and import it in Vercel (or run `vercel`).
2. In **Project → Settings → Environment Variables**, add:
   - `WEBHOOK_URL` — image generation.
   - `STRIPE_WEBHOOK_SECRET` — from the Stripe webhook endpoint (next step).
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Settings → API → `service_role`.
3. Deploy. `vercel.json` applies the security headers automatically.
4. **Register the Stripe webhook** (one-time): Stripe Dashboard → Developers →
   Webhooks → *Add endpoint* → `https://<your-domain>/api/stripe-webhook`,
   subscribed to `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`. Copy its **signing secret** into
   `STRIPE_WEBHOOK_SECRET` (step 2) and redeploy.
5. **Go live:** the repo ships the Stripe **test-mode** Payment Link
   (`pay-config.js`). When ready for real charges, create a live-mode price +
   Payment Link, swap the URL in `pay-config.js`, and register a live-mode
   webhook with its own signing secret.

### Auth in production

Login needs **no extra Vercel configuration** — the Supabase URL + publishable
key are public and baked into `auth-config.js` (no env var), and Supabase's
auth REST endpoints accept requests from any origin. Two things make it work,
both already handled:

- **CSP** — `vercel.json` already allows the Supabase origin in `connect-src`.
  This is the one thing that would otherwise block auth in production (it isn't
  enforced by the local `dev-server.mjs`, so prod is the first place it matters).
- **"Confirm email" OFF** — a Supabase *project* setting, so it applies to prod
  automatically once changed.

So deploying the latest commit is all that's required. Verify in
**Vercel → Deployments** that the newest deploy includes the auth commit, then
test signup/login on the production URL.

> **Recommended (not required):** set Supabase → **Authentication → URL
> Configuration → Site URL** to your Vercel domain. The current email + password
> flow doesn't use redirect links, but you'll want this before adding password
> reset, email confirmation, or OAuth.
