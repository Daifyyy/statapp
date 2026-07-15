import { TabulkyApp } from "../_components/TabulkyApp";

export const metadata = {
  title: "Ligové tabulky — Predictapp",
  description: "Aktuální tabulky top evropských klubových lig – pozice, body, forma.",
};

// Statická (CDN) – žádná data ani session při SSR: tabulku i uživatele (`/api/me`)
// načítá `TabulkyApp` klientsky → přepnutí na záložku je okamžité, bez server round-tripu.
export const dynamic = "force-static";

export default function TabulkyPage() {
  return (
    <div className="flex-1">
      <TabulkyApp />
    </div>
  );
}
