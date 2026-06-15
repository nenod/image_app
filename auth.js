// =========================================================
// AUTH HELPERS (Supabase GoTrue, no SDK)
// =========================================================
// Talks to the Supabase Auth REST API directly with fetch — no supabase-js, no
// CDN, no build step, so the strict CSP (script-src 'self') stays intact. The
// only CSP allowance needed is the Supabase origin in connect-src (vercel.json).
//
// Session shape we persist (localStorage key below):
//   { access_token, refresh_token, expires_at, user }
// =========================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./auth-config.js";

const AUTH_BASE = SUPABASE_URL + "/auth/v1";
const SESSION_KEY = "dkt-auth-session";

// ---------------------------------------------------------
// SESSION STORAGE
// ---------------------------------------------------------
function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// Normalise a GoTrue token response into the session we store.
function toSession(data) {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    // GoTrue gives expires_at (epoch seconds); fall back to expires_in.
    expires_at:
      data.expires_at ||
      (data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : 0),
    user: data.user || null,
  };
}

// ---------------------------------------------------------
// LOW-LEVEL REQUEST
// ---------------------------------------------------------
async function authRequest(path, body, { auth } = {}) {
  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
  };
  if (auth) headers["Authorization"] = "Bearer " + auth;

  const res = await fetch(AUTH_BASE + path, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* some endpoints (logout) return empty bodies */
  }

  if (!res.ok) {
    throw new Error(friendlyError(data, res.status));
  }
  return data;
}

// Map Supabase error payloads to short, user-facing messages.
function friendlyError(data, status) {
  const code = data && (data.error_code || data.code);
  const msg = (data && (data.msg || data.error_description || data.error)) || "";

  if (code === "user_already_exists" || /already registered/i.test(msg)) {
    return "Korisnik s ovom e-mail adresom već postoji.";
  }
  if (code === "over_email_send_rate_limit" || status === 429) {
    return "Previše pokušaja. Pričekajte nekoliko minuta i pokušajte ponovno.";
  }
  if (code === "signup_disabled") {
    return "Registracija je trenutačno onemogućena.";
  }
  if (code === "weak_password") {
    return "Lozinka je preslaba. Odaberite jaču lozinku.";
  }
  if (code === "invalid_credentials" || status === 400) {
    if (/email/i.test(msg) && /invalid/i.test(msg)) {
      return "Neispravna e-mail adresa.";
    }
    if (/password/i.test(msg)) {
      return "Lozinka mora imati najmanje 6 znakova.";
    }
    return "Neispravna e-mail adresa ili lozinka.";
  }
  if (code === "email_not_confirmed") {
    return "Potvrdite e-mail adresu prije prijave.";
  }
  return "Došlo je do pogreške. Pokušajte ponovno.";
}

// ---------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------
export async function signUp(email, password) {
  const data = await authRequest("/signup", { email, password });
  // When "Confirm email" is OFF, signup returns tokens → log in immediately.
  if (data && data.access_token) {
    writeSession(toSession(data));
    return { session: readSession(), needsConfirmation: false };
  }
  // When confirmation is ON, no tokens come back yet.
  return { session: null, needsConfirmation: true };
}

export async function signIn(email, password) {
  const data = await authRequest("/token?grant_type=password", {
    email,
    password,
  });
  writeSession(toSession(data));
  return readSession();
}

export async function signOut() {
  const session = readSession();
  if (session && session.access_token) {
    try {
      await authRequest("/logout", null, { auth: session.access_token });
    } catch {
      /* clear locally even if the server call fails */
    }
  }
  clearSession();
}

// Refresh the access token if it is expired (or about to). Returns the live
// session, or null if there is none / refresh failed (in which case it clears).
async function ensureFreshSession() {
  const session = readSession();
  if (!session) return null;

  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at - 60 > now) {
    return session; // still valid
  }

  if (!session.refresh_token) {
    clearSession();
    return null;
  }
  try {
    const data = await authRequest("/token?grant_type=refresh_token", {
      refresh_token: session.refresh_token,
    });
    writeSession(toSession(data));
    return readSession();
  } catch {
    clearSession();
    return null;
  }
}

export async function getSession() {
  return ensureFreshSession();
}

export async function getUser() {
  const session = await ensureFreshSession();
  return session ? session.user : null;
}

// Synchronous best-effort check (no network) for first paint.
export function isLoggedIn() {
  return !!readSession();
}
