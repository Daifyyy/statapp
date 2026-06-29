import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { logError } from "@/lib/logError";

// Stripe webhook – JEDINÝ zdroj přepnutí User.tier dle stavu předplatného.
// Ověřuje podpis přes RAW body (req.text()), proto se tělo nikde dřív neparsuje.
// Allowlist PRO_EMAILS zůstává nadřazený (řeší session callback v auth.ts), takže
// vlastníkův účet je PRO i kdyby ho webhook teoreticky shodil na FREE.

/** Konec aktuálního období – best-effort napříč verzemi Stripe API (jen pro UI). */
function periodEndOf(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const ts =
    item?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end;
  return ts ? new Date(ts * 1000) : null;
}

/** Promítne stav předplatného do User (tier + období). */
async function syncSubscription(sub: Stripe.Subscription) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const active = sub.status === "active" || sub.status === "trialing";

  await prisma.user.updateMany({
    where: { stripeCustomerId: customerId },
    data: {
      tier: active ? "PRO" : "FREE",
      stripeSubscriptionId: sub.id,
      proUntil: active ? periodEndOf(sub) : null,
    },
  });
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  if (!secret || !sig)
    return NextResponse.json({ error: "Webhook není nakonfigurován" }, { status: 503 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, secret);
  } catch (e) {
    logError("api/stripe.webhook.verify", e);
    return NextResponse.json({ error: "Neplatný podpis" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id
          );
          await syncSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      default:
        break; // ostatní eventy ignorujeme
    }
    return NextResponse.json({ received: true });
  } catch (e) {
    logError("api/stripe.webhook.handle", e, { type: event.type });
    return NextResponse.json({ error: "Zpracování selhalo" }, { status: 500 });
  }
}
