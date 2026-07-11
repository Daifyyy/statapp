import { TabulkyApp } from "../_components/TabulkyApp";
import { getCurrentUser } from "@/lib/authUser";
import type { SessionUser } from "../_components/sessionUser";

export const metadata = {
  title: "Ligové tabulky — Predictapp",
  description: "Aktuální tabulky top evropských klubových lig – pozice, body, forma.",
};

export default async function TabulkyPage() {
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
      <TabulkyApp user={user} />
    </div>
  );
}
