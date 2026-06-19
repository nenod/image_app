// =========================================================
// Serverless proxy: browser -> /api/generate -> n8n webhook
//
// The real webhook URL lives ONLY here, read from an environment
// variable, so it is never exposed to the browser. This runs on
// Vercel's Edge runtime (Web-standard Request/Response/FormData).
// =========================================================

import { fetchPaid } from "../lib/access.js";

export const config = { runtime: "edge" };

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per image
const UPSTREAM_TIMEOUT_MS = 120000; // 2 min

export default async function handler(req) {
  // Only POST is allowed.
  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed");
  }

  // Require a signed-in user with an ACTIVE SUBSCRIPTION. The client sends the
  // Supabase access token as a Bearer header; entitlement is checked against
  // profiles.paid (RLS scopes the read to this user). This is the real paywall
  // boundary — the UI gate alone does not protect this endpoint.
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    return errorResponse(401, "Authentication required");
  }
  let paid;
  try {
    paid = await fetchPaid(token);
  } catch (err) {
    console.error("Access check failed:", err);
    return errorResponse(502, "Could not verify access");
  }
  if (!paid) {
    return errorResponse(402, "An active subscription is required");
  }

  // The secret webhook URL is injected via the environment, never hardcoded.
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("WEBHOOK_URL environment variable is not set");
    return errorResponse(500, "Server is not configured");
  }

  // Parse the multipart body.
  let form;
  try {
    form = await req.formData();
  } catch (err) {
    console.error("Failed to parse form data:", err);
    return errorResponse(400, "Invalid request body");
  }

  const image1 = form.get("image1");
  const image2 = form.get("image2");

  // Validate both files: must be real Files, of an allowed type, non-empty,
  // and within the size limit. Never trust the client-side checks alone.
  const fileError = validateFile(image1) || validateFile(image2);
  if (fileError) {
    return errorResponse(400, fileError);
  }

  // Rebuild a clean FormData to forward (drop any extra fields a client
  // might have injected; only pass the two expected images).
  const outbound = new FormData();
  outbound.append("image1", image1, sanitizeName(image1.name));
  outbound.append("image2", image2, sanitizeName(image2.name));

  // Forward to the webhook with a timeout.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(webhookUrl, {
      method: "POST",
      body: outbound,
      signal: controller.signal,
    });
  } catch (err) {
    console.error("Upstream request failed:", err);
    return errorResponse(502, "Image service is unavailable");
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream.ok) {
    console.error("Upstream returned status", upstream.status);
    return errorResponse(502, "Image service returned an error");
  }

  // The webhook must return an image. Reject anything else so we never
  // stream untrusted/unexpected content back to the browser.
  const contentType = upstream.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    console.error("Upstream returned non-image content-type:", contentType);
    return errorResponse(502, "Image service returned an unexpected response");
  }

  // Stream the image straight back to the client.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ---- helpers ----

function validateFile(file) {
  // In the Edge runtime, file fields come back as File/Blob instances.
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return "Two image files are required";
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return "Unsupported file type (allowed: JPG, PNG, WEBP)";
  }
  if (file.size === 0) {
    return "An uploaded file is empty";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "An uploaded file exceeds the 10 MB limit";
  }
  return null;
}

// Strip path separators and control chars from the supplied filename,
// then cap its length. Implemented with a char-code filter to avoid
// embedding any control bytes in this source file.
function sanitizeName(name) {
  if (typeof name !== "string" || !name) return "upload";
  let out = "";
  for (const ch of name.replace(/[/\\]/g, "_")) {
    const code = ch.codePointAt(0);
    if (code > 31 && code !== 127) out += ch;
  }
  return out.slice(0, 200) || "upload";
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
