import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/authUser";
import { getStripe, isStripeConfigured, appBaseUrl } from "@/lib/stripe";
import { logError } from "@/lib/logError";

// Billing portal – uživatel si na straně Stripe spravuje/zruší předplatné.
// Žádný vlastní UI na fakturaci nepotřebujeme; zrušení se promítne zpět webhookem.
export async function POST() {
  if (!isStripeConfigured())
    return NextResponse.json({ error: "Platby nejsou nakonfigurovány" }, { status: 503 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { stripeCustomerId: true },
    });
    if (!dbUser?.stripeCustomerId)
      return NextResponse.json({ error: "Žádné předplatné" }, { status: 404 });

    const session = await getStripe().billingPortal.sessions.create({
      customer: dbUser.stripeCustomerId,
      return_url: `${appBaseUrl()}/porovnani`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    logError("api/stripe.portal", e, { userId: user.id });
    return NextResponse.json({ error: "Portál se nepodařilo otevřít" }, { status: 502 });
  }
}
