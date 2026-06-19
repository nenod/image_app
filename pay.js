// =========================================================
// PAY GATE (pay.html)
// =========================================================
// Shown to signed-in users who do not yet have an active subscription. Builds
// the Stripe Payment Link with the mapping params the webhook needs, and — when
// the user returns from Stripe (?paid) — polls profiles.paid until the webhook
// has granted access, then forwards to the generator.
// =========================================================

import { getSession, signOut } from "./auth.js";
import { fetchPaid } from "./lib/access.js";
import { STRIPE_PAYMENT_LINK } from "./pay-config.js";

const payBtn = document.getElementById("payBtn");
const statusEl = document.getElementById("payStatus");
const emailEl = document.getElementById("payEmail");
const logoutBtn = document.getElementById("payLogout");

function setStatus(text) {
  statusEl.textContent = text;
  statusEl.hidden = false;
}

async function init() {
  const session = await getSession();
  if (!session || !session.user) {
    window.location.replace("login.html");
    return;
  }

  emailEl.textContent = session.user.email;

  // Already subscribed? Skip straight to the generator.
  if (await fetchPaid(session.access_token)) {
    window.location.replace("index.html");
    return;
  }

  // Build the Payment Link with the params the webhook maps back to this user.
  const url = new URL(STRIPE_PAYMENT_LINK);
  url.searchParams.set("client_reference_id", session.user.id);
  url.searchParams.set("prefilled_email", session.user.email);
  payBtn.href = url.toString();

  logoutBtn.addEventListener("click", async () => {
    await signOut();
    window.location.replace("login.html");
  });

  // Returning from Stripe: wait for the webhook to flip profiles.paid.
  if (new URLSearchParams(window.location.search).has("paid")) {
    pollUntilPaid();
  }
}

async function pollUntilPaid() {
  payBtn.setAttribute("aria-disabled", "true");
  setStatus("Provjeravamo vašu pretplatu…");

  for (let attempt = 0; attempt < 20; attempt++) {
    const session = await getSession();
    if (session && (await fetchPaid(session.access_token))) {
      window.location.replace("index.html");
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  payBtn.removeAttribute("aria-disabled");
  setStatus("Pretplata još nije potvrđena. Osvježite stranicu za nekoliko trenutaka.");
}

init();
