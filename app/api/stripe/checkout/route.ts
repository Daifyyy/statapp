import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/authUser";
import { getStripe, isStripeConfigured, appBaseUrl } from "@/lib/stripe";
import { allowRequest, tooMany } from "@/lib/rateLimit";
import { logError } from "@/lib/logError";

// Zahájí Stripe Checkout (subscription) pro přihlášeného uživatele a vrátí URL.
// Tier se NEnastavuje tady – až webhook po zaplacení přepne User.tier na PRO
// (jediný zdroj pravdy). Tady jen založíme/spárujeme Stripe customer.
export async function POST() {
  if (!isStripeConfigured())
    return NextResponse.json({ error: "Platby nejsou nakonfigurovány" }, { status: 503 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });
  if (user.tier === "PRO")
    return NextResponse.json({ error: "Už máš PRO" }, { status: 409 });

  if (!allowRequest(`checkout:${user.id}`, 10, 60_000)) return tooMany();

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true, stripeCustomerId: true },
    });

    // Najdi/vytvoř Stripe customer a ulož ho na uživatele (mapování pro webhook).
    let customerId = dbUser?.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await getStripe().customers.create({
        email: dbUser?.email ?? undefined,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const base = appBaseUrl();
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${base}/porovnani?upgraded=1`,
      cancel_url: `${base}/porovnani?canceled=1`,
      metadata: { userId: user.id },
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    logError("api/stripe.checkout", e, { userId: user.id });
    return NextResponse.json({ error: "Platbu se nepodařilo zahájit" }, { status: 502 });
  }
}
