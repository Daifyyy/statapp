import { PicksApp } from "../_components/PicksApp";
import { getCurrentUser } from "@/lib/authUser";
import type { SessionUser } from "../_components/sessionUser";

export const metadata = {
  title: "Predikční tipy — Predictapp",
  description: "Nadcházející zápasy vybrané podle pravidel (PRO).",
};

export default async function PredikcePage() {
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
  return (
    <div className="flex-1">
      <PicksApp user={user} />
    </div>
  );
}
