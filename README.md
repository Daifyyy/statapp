# Predictapp — statistické porovnání fotbalových týmů

Webová aplikace pro porovnání klubů a reprezentací. Pro každý tým počítá
**vážený průměr** metrik (vstřelené/obdržené góly, rohy, fauly, xG, střely)
ve variantách **Doma / Venku / Celkově** ze tří časových oken
(minulá sezóna 15 % · posledních 10 zápasů 30 % · posledních 5 zápasů 55 %),
plus automatické **insights** (forma, slabiny, rozdíl domácí/venkovní výkon).

Data: [API-Football](https://www.api-football.com/) (read-through cache do Postgresu).

## Stack
- **Next.js 16** (App Router) + **TypeScript** + **Tailwind CSS 4**
- **Prisma 6** + **Postgres** (Neon) jako cache vrstva
- **Vitest** (unit testy výpočetního jádra)
- Deploy: **Vercel** (+ Vercel Cron pro předehřívání katalogu)

## Lokální vývoj
```bash
npm install
cp .env.example .env   # doplň API_FOOTBALL_KEY a DATABASE_URL
npx prisma db push     # vytvoří tabulky cache
npm run dev            # http://localhost:3000
```
Bez `.env` běží aplikace na deterministických **mock datech** (žádný klíč ani DB
není potřeba). S `.env` čte reálná data z API-Football.

> **Pozn. (jen některé Windows stroje s TLS proxy):** pokud `fetch`/`npm` selhává
> na certifikát, spouštěj s `NODE_OPTIONS=--use-system-ca`. Na Vercelu netřeba.

## Architektura (stručně)
- **Katalog** (ligy, konfederace, seznamy týmů) — dynamicky z API, cache (`ApiCache`).
- **Zápasová data** (per-zápas statistiky) — **líně** stahovaná jen pro porovnané
  týmy, cache **natrvalo** (`MatchStatCache`). Žádný hromadný download.
- **Výpočetní jádro** (`lib/stats`) je čistě funkční a na zdroji dat nezávislé
  (mock i reálná data tečou stejnou cestou).
- **Rate-limiting**: globální serializace volání + krátký retry (API-Football má
  distribuovaný limit 300/min).

## Skripty
| Příkaz | Co dělá |
|---|---|
| `npm run dev` / `build` / `start` | vývoj / produkční build / produkční server |
| `npm test` | unit testy jádra (vážený průměr, okna, zdroj dat, insights) |
| `npm run typecheck` / `lint` | kontrola typů / ESLint |

## Endpointy
- `GET /api/leagues` — katalog lig + konfederací
- `GET /api/teams?league=ID` — týmy ligy / reprezentace konfederace
- `GET /api/compare?home=&away=&homeLeague=&awayLeague=` — porovnání
- `GET /api/warm` — předehřátí katalogu (cron); `?league=ID` předehřeje data ligy

## Pokrytí
~18 top evropských klubových lig + všechny reprezentace FIFA po konfederacích
(UEFA, CONMEBOL, CONCACAF, CAF, AFC, OFC) — dynamicky z API.
