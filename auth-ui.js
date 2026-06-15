// =========================================================
// LOGIN GATE + HEADER ACCOUNT CONTROL (index.html)
// =========================================================
// The generator is protected: visitors must be signed in. This script
//   1. redirects to login.html when there is no valid session, and
//   2. once signed in, reveals the page (removes body.gated) and renders the
//      header account control (email + "Odjava" logout).
//
// NOTE: this guards the UI only. It does NOT secure /api/generate — that would
// require verifying the Supabase JWT inside the Edge proxy (api/generate.js).
// =========================================================

import { getUser, signOut, isLoggedIn } from "./auth.js";

// Fast path: no session at all → redirect immediately, before any reveal.
if (!isLoggedIn()) {
  window.location.replace("login.html");
}

const account = document.getElementById("account");

// Escape the email before injecting it as HTML (defence in depth).
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderSignedIn(user) {
  const email = escapeHtml(user.email);
  account.innerHTML = `
    <span class="account__user" title="${email}">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg>
      <span class="account__label">${email}</span>
    </span>
    <button class="account__logout" id="logoutBtn" type="button">Odjava</button>`;

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await signOut();
    window.location.replace("login.html");
  });
}

async function init() {
  // Validate (and refresh if needed) the stored session.
  const user = await getUser();
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  document.body.classList.remove("gated"); // reveal the protected page
  renderSignedIn(user);
}

init();
