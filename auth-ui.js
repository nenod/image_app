// =========================================================
// LOGIN GATE + HEADER ACCOUNT CONTROL (index.html)
// =========================================================
// The generator is protected: visitors must be signed in. This script
//   1. redirects to login.html when there is no valid session, and
//   2. once signed in, reveals the page (removes body.gated) and renders the
//      header account control (email + "Odjava" logout).
//
// Access also requires an ACTIVE SUBSCRIPTION: unpaid users are sent to
// pay.html. This guards the UI; /api/generate enforces the same check
// server-side (so the API is protected even if this gate is bypassed).
// =========================================================

import { getSession, signOut, isLoggedIn } from "./auth.js";
import { fetchPaid } from "./lib/access.js";

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
  const session = await getSession();
  if (!session || !session.user) {
    window.location.replace("login.html");
    return;
  }
  // Signed in but no active subscription → send to the pay page.
  if (!(await fetchPaid(session.access_token))) {
    window.location.replace("pay.html");
    return;
  }
  document.body.classList.remove("gated"); // reveal the protected page
  renderSignedIn(session.user);
}

init();
