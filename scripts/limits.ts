// Vypíše rate-limit hlavičky (spotřeba denní kvóty). Spuštění: npm run limits
//
// Pozn.: kód musí být v `main()`, ne na top-levelu – `tsx` tenhle soubor transformuje do
// CJS a top-level `await` tam esbuild odmítne („Transform failed"). Ostatní skripty na to
// nenarazí, protože mají importy a jedou jako ESM.
const BASE = "https://v3.football.api-sports.io";

const interesting = [
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "X-RateLimit-Limit",
  "X-RateLimit-Remaining",
  "x-ratelimit-requests-limit",
  "x-ratelimit-requests-remaining",
];

async function main() {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    console.log("Chybí API_FOOTBALL_KEY v .env");
    return;
  }
  const res = await fetch(`${BASE}/status`, {
    headers: { "x-apisports-key": key },
  });
  for (const [k, v] of res.headers.entries()) {
    if (k.toLowerCase().includes("ratelimit") || k.toLowerCase().includes("rate")) {
      console.log(`${k}: ${v}`);
    }
  }
  console.log("---");
  console.log("known header names:");
  for (const h of interesting) console.log(`${h}: ${res.headers.get(h)}`);
}

main();
