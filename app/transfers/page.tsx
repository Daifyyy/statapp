import { TransfersApp } from "../_components/TransfersApp";
import { getLeagues } from "@/lib/data/repository";
import { TRANSFER_LEAGUES } from "@/lib/data/transfers";
import { getCurrentUser } from "@/lib/authUser";
import type { SessionUser } from "../_components/sessionUser";

export const metadata = {
  title: "Přestupy — Predictapp",
  description: "Aktuální přestupy top-5 evropských lig a bilance klubů (PRO).",
};

export default async function TransfersPage() {
  const cu = await getCurrentUser();
  const user: SessionUser | null = cu
    ? {
        id: cu.id,
        name: cu.name,
        image: cu.image,
        tier: cu.tier,
        proTrialUsed: cu.proTrialUsed,
      }
    : null;

  // Jen top-5 ligy, které v daném režimu existují (mock = jen 39/140).
  const leagues = getLeagues()
    .filter((l) => TRANSFER_LEAGUES.includes(l.id))
    .map((l) => ({ id: l.id, name: l.name }));

  return (
    <div className="flex-1">
      <TransfersApp user={user} leagues={leagues} />
    </div>
  );
}
