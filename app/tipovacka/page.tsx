import type { Metadata } from "next";
import { TipovackaApp } from "../_components/TipovackaApp";
import { getFixturesByDates } from "@/lib/data/repository";
import { getCurrentUser } from "@/lib/authUser";
import type { SessionUser } from "../_components/sessionUser";

export const metadata: Metadata = {
  title: "Tipovačka — vyzkoušej si svou intuici | Predictapp",
  description:
    "Tipuj výsledky zápasů na intuici (bez kurzů) a sleduj svou úspěšnost i ROI vůči kurzům. Osobní tréninkový deník tipů.",
};

/** Kolik dní dopředu nabídnout k tipování (dnes + dalších 6). */
const LOOKAHEAD_DAYS = 7;

function pragueDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export default async function TipovackaPage() {
  const cu = await getCurrentUser();
  const user: SessionUser | null = cu
    ? { id: cu.id, name: cu.name, image: cu.image, tier: cu.tier, proTrialUsed: cu.proTrialUsed }
    : null;

  const now = new Date();
  const dates = Array.from({ length: LOOKAHEAD_DAYS }, (_, i) =>
    pragueDate(new Date(now.getTime() + i * 24 * 60 * 60 * 1000))
  );
  const days = await getFixturesByDates(dates);

  return (
    <div className="flex-1">
      <TipovackaApp days={days} user={user} />
    </div>
  );
}
