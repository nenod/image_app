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
| `auth-ui.js` | Renders the header account control on `index.html` |
| `auth-config.js` | **Public** Supabase URL + publishable key (safe to commit) |
| `vercel.json` | Security headers (CSP, HSTS, nosniff, frame/clickjacking, etc.) |
| `dev-server.mjs` | Local dev server that runs the real proxy without the Vercel CLI |
| `.env.example` | Template for the required env var |

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

> The gate is **client-side only** — it protects the UI, not `/api/generate`.
> A determined user could still call the proxy directly. To enforce auth on
> generation, verify the Supabase JWT inside the Edge proxy (`api/generate.js`).

## Security measures

- **Secret isolation** — webhook URL only in `WEBHOOK_URL`, server-side.
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
cp .env.example .env.local   # then put the real WEBHOOK_URL in .env.local
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
2. In **Project → Settings → Environment Variables**, add `WEBHOOK_URL`.
3. Deploy. `vercel.json` applies the security headers automatically.
