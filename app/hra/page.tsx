import { HraApp } from "../_components/HraApp";
import { getCurrentUser } from "@/lib/authUser";
import type { SessionUser } from "../_components/sessionUser";

export const metadata = {
  title: "Hra: Manažer — Predictapp",
  description:
    "Klubový manažer se simulací ligy. Vyber tým, zvol taktiku a odehraj sezónu — na stejném predikčním modelu jako reálné tipy.",
};

export default async function HraPage() {
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
      <HraApp user={user} />
    </div>
  );
}
