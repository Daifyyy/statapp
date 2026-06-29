// Stripe klient (singleton) + drobné helpery. Klíče žijí jen na serveru.
// Pozn. (lokál): odchozí TLS na Stripe API → spouštěj s NODE_OPTIONS=--use-system-ca
// (stejně jako api-sports / Google token exchange). Na Vercelu netřeba.

import Stripe from "stripe";

const globalForStripe = globalThis as unknown as { stripe?: Stripe };

export const stripe =
  globalForStripe.stripe ??
  new Stripe(process.env.STRIPE_SECRET_KEY ?? "", { typescript: true });

if (process.env.NODE_ENV !== "production") globalForStripe.stripe = stripe;

/** Je Stripe nakonfigurovaný? Bez něj placený upgrade není dostupný (běží jen trial). */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

/** Stabilní základ pro redirect URL (success/cancel/return). Sdílí AUTH_URL. */
export function appBaseUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}
