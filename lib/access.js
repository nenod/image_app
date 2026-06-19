// =========================================================
// ACCESS CHECK (shared: browser gate + Edge proxy)
// =========================================================
// Reads the caller's own profiles.paid flag from Supabase using THEIR access
// token. Row Level Security guarantees the query returns only that user's row,
// so this same helper is safe to run client-side (UI gate) and server-side
// (api/generate.js enforcement). No secrets here — it uses the public
// publishable key plus the user's bearer token.
// =========================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../auth-config.js";

// Resolve to `true` only when the user has an active/paying subscription
// (profiles.paid is kept in sync with Stripe by api/stripe-webhook.js).
export async function fetchPaid(accessToken) {
  if (!accessToken) return false;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=paid`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + accessToken,
    },
  });
  if (!res.ok) return false;

  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 && rows[0].paid === true;
}
