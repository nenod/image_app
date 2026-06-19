// =========================================================
// STRIPE PAYMENT LINK (PUBLIC)
// =========================================================
// Like auth-config.js, this value is PUBLIC by design — a Stripe Payment Link
// is just a hosted checkout URL meant to be opened in the browser. The secrets
// (webhook signing secret, service-role key) live server-side only, in env vars.
//
// This is the TEST-MODE link ($9.99/month subscription). Swap it for the live
// link when you flip Stripe to live mode.
//
// The client appends ?client_reference_id=<supabase user id>&prefilled_email=…
// so the Stripe webhook can map the resulting subscription back to the user.
// =========================================================
export const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/test_bJe28q48g1AgcTO9S21Fe00";
