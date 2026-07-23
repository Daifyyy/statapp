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

function num(v: string | string[] | undefined): number | undefined {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : undefined;
}

export default async function TipovackaPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const cu = await getCurrentUser();
  const user: SessionUser | null = cu
    ? { id: cu.id, name: cu.name, image: cu.image, tier: cu.tier, proTrialUsed: cu.proTrialUsed }
    : null;

  const now = new Date();
  const dates = Array.from({ length: LOOKAHEAD_DAYS }, (_, i) =>
    pragueDate(new Date(now.getTime() + i * 24 * 60 * 60 * 1000))
  );
  const days = await getFixturesByDates(dates);
  const sp = await searchParams;
  const initialFixtureId = num(sp.fixture);

  return (
    <div className="flex-1">
      <TipovackaApp days={days} user={user} initialFixtureId={initialFixtureId} />
    </div>
  );
}
