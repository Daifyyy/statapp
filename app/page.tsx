import { CompareApp } from "./_components/CompareApp";
import { getLeagues } from "@/lib/data/repository";

export default function Home() {
  const leagues = getLeagues();
  return (
    <div className="flex-1">
      <CompareApp leagues={leagues} />
      <footer className="mx-auto max-w-3xl px-4 py-8 text-center text-xs text-muted">
        Vážený průměr: minulá sezóna 15 % · posl. 10 zápasů 30 % · posl. 5
        zápasů 55 %. Data: API-Football.
      </footer>
    </div>
  );
}
