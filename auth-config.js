// =========================================================
// SUPABASE CLIENT CONFIG (PUBLIC)
// =========================================================
// Unlike the n8n WEBHOOK_URL (which is a secret and lives only server-side in
// api/generate.js), these two values are PUBLIC by design. Supabase ships the
// project URL and the *publishable* key in the browser — Row Level Security and
// the Auth service enforce access, not the secrecy of this key. Safe to commit.
//
// Rotate / find these in: Supabase Dashboard → Project Settings → API.
// =========================================================
export const SUPABASE_URL = "https://kxburbtkxawiczbfgddw.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_Kaot1y_0ZpLV-cspV0i3YA_JkDAcdb5";
