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
| `styles.css` | All styling |
| `app.js` | Client logic: previews, validation, calls `/api/generate` |
| `api/generate.js` | Edge serverless proxy that holds the secret and validates input |
| `vercel.json` | Security headers (CSP, HSTS, nosniff, frame/clickjacking, etc.) |
| `.env.example` | Template for the required env var |

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

The serverless function requires the Vercel CLI (plain static hosting can't run
`/api`):

```bash
npm i -g vercel        # one-time
cp .env.example .env.local   # then put the real WEBHOOK_URL in .env.local
vercel dev             # serves the site + /api/generate at http://localhost:3000
```

> `.env.local` is gitignored — never commit it.

## Deploy (Vercel)

1. Push this folder to a Git repo and import it in Vercel (or run `vercel`).
2. In **Project → Settings → Environment Variables**, add `WEBHOOK_URL`.
3. Deploy. `vercel.json` applies the security headers automatically.
