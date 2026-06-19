// =========================================================
// Local dev server (no Vercel account needed).
//
// Serves the static files AND runs the real api/generate.js proxy
// handler, so local behaviour matches production. Reads WEBHOOK_URL
// from .env.local. For production, deploy to Vercel (see README).
//
//   node dev-server.mjs   ->   http://localhost:3000
// =========================================================

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import handler from "./api/generate.js";
import stripeWebhookHandler from "./api/stripe-webhook.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = process.env.PORT || 3000;

// ---- Load .env.local into process.env (simple KEY=VALUE parser) ----
const envPath = join(ROOT, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ---- API: delegate to the real Edge handlers (same code as production) ----
  const apiHandler =
    url.pathname === "/api/generate" ? handler :
    url.pathname === "/api/stripe-webhook" ? stripeWebhookHandler :
    null;

  if (apiHandler) {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);

      const request = new Request(url.href, {
        method: req.method,
        headers: req.headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      });

      const webRes = await apiHandler(request);
      res.statusCode = webRes.status;
      webRes.headers.forEach((v, k) => res.setHeader(k, v));
      if (webRes.body) {
        Readable.fromWeb(webRes.body).pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      console.error(`dev-server ${url.pathname} error:`, err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Local server error" }));
    }
    return;
  }

  // ---- Static files ----
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  // Prevent path traversal: resolve and ensure it stays under ROOT.
  const filePath = normalize(join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME[extname(filePath)] || "application/octet-stream");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain");
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  const ok = process.env.WEBHOOK_URL ? "set ✓" : "MISSING ✗ (set it in .env.local)";
  console.log(`Dev server: http://localhost:${PORT}`);
  console.log(`WEBHOOK_URL: ${ok}`);
});
