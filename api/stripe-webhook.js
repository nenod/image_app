// =========================================================
// Serverless Stripe webhook: keeps profiles.paid in sync with Stripe.
//
// Stripe POSTs subscription lifecycle events here. We verify the signature
// (Web Crypto HMAC-SHA256 — no Stripe SDK, so the strict CSP / no-build setup
// stays intact), then flip public.profiles.paid using the Supabase service-role
// key (which bypasses RLS). Secrets live ONLY in env vars:
//   STRIPE_WEBHOOK_SECRET      — the endpoint's signing secret (whsec_…)
//   SUPABASE_SERVICE_ROLE_KEY  — service role key (server-side only, never shipped)
//
// Mapping: the first event (checkout.session.completed) carries
// client_reference_id = the Supabase user id; we persist the Stripe customer +
// subscription ids so every later event can be matched back to the user.
// =========================================================

export const config = { runtime: "edge" };

import { SUPABASE_URL } from "../auth-config.js";

const SIG_TOLERANCE_SEC = 300; // reject events whose timestamp is >5 min skewed

export default async function handler(req) {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!signingSecret || !serviceKey) {
    console.error("Stripe webhook is not configured (missing env vars)");
    return json(500, { error: "Server is not configured" });
  }

  // Raw body is required for signature verification — read it verbatim.
  const raw = await req.text();
  const signature = req.headers.get("stripe-signature") || "";

  const valid = await verifyStripeSignature(raw, signature, signingSecret);
  if (!valid) {
    console.error("Stripe webhook signature verification failed");
    return json(400, { error: "Invalid signature" });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  try {
    await handleEvent(event, serviceKey);
  } catch (err) {
    // Returning 5xx tells Stripe to retry later (transient Supabase issue etc.).
    console.error("Stripe webhook handling error:", err);
    return json(500, { error: "Handler error" });
  }

  return json(200, { received: true });
}

// ---------------------------------------------------------
// EVENT HANDLING
// ---------------------------------------------------------
async function handleEvent(event, serviceKey) {
  const type = event.type;
  const obj = (event.data && event.data.object) || {};

  if (type === "checkout.session.completed") {
    // First touch: map the subscription to the Supabase user and grant access.
    const userId = obj.client_reference_id;
    if (!userId) {
      console.error("checkout.session.completed without client_reference_id");
      return;
    }
    await patchProfile(serviceKey, `id=eq.${encodeURIComponent(userId)}`, {
      paid: true,
      stripe_customer_id: obj.customer || null,
      stripe_subscription_id: obj.subscription || null,
      subscription_status: "active",
      updated_at: new Date().toISOString(),
    });
    return;
  }

  if (type === "customer.subscription.updated" || type === "customer.subscription.created") {
    const status = obj.status;
    await patchProfile(
      serviceKey,
      `stripe_subscription_id=eq.${encodeURIComponent(obj.id)}`,
      {
        paid: status === "active" || status === "trialing",
        subscription_status: status,
        current_period_end: obj.current_period_end
          ? new Date(obj.current_period_end * 1000).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      }
    );
    return;
  }

  if (type === "customer.subscription.deleted") {
    // Subscription cancelled → revoke access.
    await patchProfile(
      serviceKey,
      `stripe_subscription_id=eq.${encodeURIComponent(obj.id)}`,
      {
        paid: false,
        subscription_status: obj.status || "canceled",
        updated_at: new Date().toISOString(),
      }
    );
    return;
  }

  if (type === "invoice.payment_failed") {
    // A renewal payment failed → revoke access (lapsed).
    const subId = obj.subscription;
    if (!subId) return;
    await patchProfile(
      serviceKey,
      `stripe_subscription_id=eq.${encodeURIComponent(subId)}`,
      {
        paid: false,
        subscription_status: "past_due",
        updated_at: new Date().toISOString(),
      }
    );
    return;
  }

  // Any other event type is acknowledged (200) and ignored.
}

// PATCH public.profiles via PostgREST with the service-role key (bypasses RLS).
async function patchProfile(serviceKey, filter, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?${filter}`, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      Authorization: "Bearer " + serviceKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Supabase PATCH failed (${res.status}): ${detail}`);
  }
}

// ---------------------------------------------------------
// SIGNATURE VERIFICATION (Stripe scheme, Web Crypto HMAC-SHA256)
// ---------------------------------------------------------
// Header looks like:  t=1492774577,v1=5257a8...,v0=...
// signed_payload = `${t}.${rawBody}` ; compare HMAC-SHA256 to a v1 value.
async function verifyStripeSignature(payload, header, secret) {
  let timestamp = null;
  const v1 = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") v1.push(value);
  }
  if (!timestamp || v1.length === 0) return false;

  // Replay protection: reject events outside the tolerance window.
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(timestamp))) return false;
  if (Math.abs(now - Number(timestamp)) > SIG_TOLERANCE_SEC) return false;

  const expected = await hmacHex(secret, `${timestamp}.${payload}`);
  // Stripe may send multiple v1 signatures; accept if any matches.
  return v1.some((candidate) => timingSafeEqual(expected, candidate));
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time string comparison (avoid leaking the secret via timing).
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
