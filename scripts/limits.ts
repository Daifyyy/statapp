// Vypíše rate-limit hlavičky. Spuštění: node --env-file=.env scripts/limits.ts
const BASE = "https://v3.football.api-sports.io";
const key = process.env.API_FOOTBALL_KEY!;

const res = await fetch(`${BASE}/status`, {
  headers: { "x-apisports-key": key },
});
const interesting = [
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "X-RateLimit-Limit",
  "X-RateLimit-Remaining",
  "x-ratelimit-requests-limit",
  "x-ratelimit-requests-remaining",
];
for (const [k, v] of res.headers.entries()) {
  if (k.toLowerCase().includes("ratelimit") || k.toLowerCase().includes("rate")) {
    console.log(`${k}: ${v}`);
  }
}
console.log("---");
console.log("known header names:");
for (const h of interesting) console.log(`${h}: ${res.headers.get(h)}`);
