import { DigestApp } from "../_components/DigestApp";
import { getCurrentUser } from "@/lib/authUser";
import type { SessionUser } from "../_components/sessionUser";

export const metadata = {
  title: "Value tipy týdne — Predictapp",
  description: "Nejvýhodnější tipy nejbližších dní – největší hrana nad kurzem sázkovky (PRO).",
};

export default async function DigestPage() {
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
      <DigestApp user={user} />
    </div>
  );
}
