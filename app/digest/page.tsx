import { DigestApp } from "../_components/DigestApp";
import { getCurrentUser } from "@/lib/authUser";
import type { SessionUser } from "../_components/sessionUser";

// Jméno sekce je „Vs. trh" – stejně v navigaci, v `h1` i tady. Dřív měla jedna stránka
// čtyři názvy (route `/digest`, h1 „Kde se lišíme od trhu", pilulka „Vs. trh", jiný title).
//
// Popisek taky nesmí slibovat „nejvýhodnější tipy" a „největší hranu": měření ukázalo,
// že model trh neporáží a že větší neshoda vycházela HŮŘ. Stránka to říká v podtitulku,
// takže by si s ní metadata protiřečila.
export const metadata = {
  title: "Vs. trh — kde se lišíme od kurzů | Predictapp",
  description:
    "Zápasy nejbližších 7 dní, kde se náš odhad nejvíc rozchází s odmaržovanými kurzy. Pozvánka podívat se proč – ne sázkový tip (PRO).",
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
