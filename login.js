// =========================================================
// LOGIN PAGE
// =========================================================
// Wires the Prijava / Registracija form to the Supabase auth helpers. All
// network calls live in auth.js — this file is just UI glue + validation.
// =========================================================

import { signIn, signUp, isLoggedIn } from "./auth.js";

// Already signed in? No reason to be here.
if (isLoggedIn()) {
  window.location.replace("index.html");
}

// ---- Element refs ----
const tabLogin = document.getElementById("tabLogin");
const tabSignup = document.getElementById("tabSignup");
const form = document.getElementById("authForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const passwordHint = document.getElementById("passwordHint");
const message = document.getElementById("authMessage");
const submitBtn = document.getElementById("submitBtn");

// "login" | "signup"
let mode = "login";

// ---------------------------------------------------------
// MODE SWITCHING
// ---------------------------------------------------------
function setMode(next) {
  mode = next;
  const isLogin = next === "login";

  tabLogin.classList.toggle("is-active", isLogin);
  tabSignup.classList.toggle("is-active", !isLogin);
  tabLogin.setAttribute("aria-selected", String(isLogin));
  tabSignup.setAttribute("aria-selected", String(!isLogin));

  submitBtn.textContent = isLogin ? "Prijava" : "Registracija";
  passwordInput.autocomplete = isLogin ? "current-password" : "new-password";
  passwordHint.hidden = isLogin; // only relevant when creating a password
  clearMessage();
}

tabLogin.addEventListener("click", () => setMode("login"));
tabSignup.addEventListener("click", () => setMode("signup"));

// ---------------------------------------------------------
// MESSAGING
// ---------------------------------------------------------
function showMessage(text, kind) {
  message.textContent = text;
  message.className = "auth-message is-visible auth-message--" + kind;
}

function clearMessage() {
  message.textContent = "";
  message.className = "auth-message";
}

// ---------------------------------------------------------
// VALIDATION (mirrors Supabase defaults)
// ---------------------------------------------------------
function validate(email, password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Unesite ispravnu e-mail adresu.";
  }
  if (password.length < 6) {
    return "Lozinka mora imati najmanje 6 znakova.";
  }
  return null;
}

// ---------------------------------------------------------
// SUBMIT
// ---------------------------------------------------------
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  const localError = validate(email, password);
  if (localError) {
    showMessage(localError, "error");
    return;
  }

  submitBtn.disabled = true;
  clearMessage();

  try {
    if (mode === "login") {
      await signIn(email, password);
      window.location.replace("index.html");
      return;
    }

    // Sign up
    const { needsConfirmation } = await signUp(email, password);
    if (needsConfirmation) {
      showMessage(
        "Račun je kreiran. Provjerite e-mail za potvrdu prije prijave.",
        "success"
      );
      setMode("login");
      submitBtn.disabled = false;
      return;
    }
    // Instant login (Confirm email is OFF)
    window.location.replace("index.html");
  } catch (err) {
    showMessage(err.message, "error");
    submitBtn.disabled = false;
  }
});

// Default view
setMode("login");
