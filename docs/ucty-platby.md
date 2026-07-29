# Účty, tiering (FREE/PRO) a platby (Stripe)

## Účty / tiering / oblíbené (FREE vs PRO)
- **Auth:** Auth.js v5 (`next-auth`) + `@auth/prisma-adapter`, session strategie **database**
  (tabulky `User`/`Account`/`Session`/`VerificationToken` v Neonu). Konfigurace `auth.ts`
  (root), handlery `app/api/auth/[...nextauth]/route.ts`, provider **Google**. Session se
  čte bezpečně přes `getCurrentUser()` (`lib/authUser.ts`) – když auth není nakonfigurovaná
  (chybí `AUTH_SECRET`) nebo selže, vrací `null` → app běží dál jako anonym (FREE).
- **Tiering = gating na hranici route, jádro zůstává čisté.** `compareTeams` se NEMĚNÍ;
  PRO obsah ořezává `toFreeResult` (`lib/entitlements.ts`) až v `/api/compare`. FREE =
  metriky + souhrn formy + sdílení URL; PRO = predikce, insights, zranění, oblíbené.
  `CompareResult.prediction`/`insightReport` jsou proto **volitelné** + flag `locked`.
- **Trial:** přihlášený FREE uživatel může **1×** odemknout plnou PRO verzi jednoho
  porovnání (`User.proTrialUsed`). UI volá `/api/compare?unlock=1`; server přes
  `getEntitlement` spotřebuje trial. Zranění (`/api/injuries`) jsou **plně PRO** (mimo trial).
- **Always-PRO allowlist:** env `PRO_EMAILS` (čárkami oddělené e-maily) → `isProEmail`
  (`lib/entitlements.ts`) v session callbacku `auth.ts` přepíše tier na PRO bez ohledu na DB
  (přežije reset DB i nové přihlášení). Vlastníkův účet patří sem, ne do ručního DB updatu.
- **Oblíbené (PRO):** `SavedComparison` drží IDs (re-run) **i JSON `snapshot`** celého
  `CompareResult` (okamžité zobrazení „jak to bylo" bez fetchu) + `snapshotVersion`.
  API `app/api/favorites` (GET/POST upsert) + `[id]` (DELETE). UI `FavoritesSection.tsx`;
  načtení snapshotu přeskočí auto-fetch (`skipAutoRef` v `CompareApp`), „Aktualizovat" re-runne.
- **Gating v UI:** `ProLock.tsx` (zámek + CTA dle stavu: přihlásit / trial 1× / upgrade),
  `AccountMenu.tsx` (přihlášení Google, tier odznak, odhlášení). PRO sekce v `CompareApp`
  se renderují jen když `!result.locked`.

## Platby (Stripe) — PRO předplatné [ROZPRACOVÁNO, dokončit příště]
- **Princip:** placený upgrade FREE→PRO přes **Stripe subscription**. `User.tier` zůstává
  **jediný spínač** PRO; jádro (`compareTeams`/`getEntitlement`/`toFreeResult`) se NEMĚNÍ.
  Allowlist `PRO_EMAILS` je dál nadřazený (vlastník je PRO bez ohledu na Stripe).
- **Kód (HOTOVO, typecheck+lint OK, Stripe SDK 22.3.0):**
  - `lib/stripe.ts` – singleton klient + `isStripeConfigured()` + `appBaseUrl()` (sdílí `AUTH_URL`).
  - `app/api/stripe/checkout/route.ts` (POST) – přihlášený uživatel, najde/vytvoří Stripe
    customer (uloží `stripeCustomerId`), vrátí Checkout URL (mode `subscription`, `STRIPE_PRICE_ID`).
  - `app/api/stripe/webhook/route.ts` (POST) – **JEDINÉ místo přepnutí `tier`**. Ověřuje podpis
    přes RAW body (`req.text()` + `constructEventAsync`, `STRIPE_WEBHOOK_SECRET`). Na
    `checkout.session.completed` + `customer.subscription.{created,updated,deleted}` → `syncSubscription`
    (`updateMany` dle `stripeCustomerId`: active/trialing→PRO+`proUntil`, jinak FREE). `periodEndOf`
    čte konec období best-effort napříč verzemi API (jen pro UI).
  - `app/api/stripe/portal/route.ts` (POST) – Stripe billing portal (správa/zrušení).
  - `prisma/schema.prisma`: `User` += `stripeCustomerId @unique`, `stripeSubscriptionId`, `proUntil`.
  - UI: `ProLock.tsx` po-trial větev = tlačítko „Upgradovat na PRO" (`/api/stripe/checkout`,
    event `upgrade_click`); `AccountMenu.tsx` pro PRO = „💳 Spravovat předplatné" (`/api/stripe/portal`).
- **ZBÝVÁ RUČNĚ (příště):**
  1. Stripe dashboard (test mód): produkt „Predictapp PRO" 99 Kč/měs → **Price ID**; aktivovat Customer portal.
  2. `NODE_OPTIONS=--use-system-ca npx prisma db push` (nová nullable pole; Neon sdílená s prod → nasadit kód hned).
  3. `.env`: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`.
  4. Lokální test: `stripe listen --forward-to localhost:3000/api/stripe/webhook` (dá `whsec_`),
     karta `4242 4242 4242 4242` → ověř PRO; `stripe trigger customer.subscription.deleted` → návrat FREE.
     (Stripe volání lokálně přes `--use-system-ca` jako api-sports/Google.)
  5. Go-live: live klíče + prod webhook endpoint `…/api/stripe/webhook` na Vercelu → redeploy.
  6. Mimo kód: obchodní podmínky + zásady + DPH/OSS (zvážit Stripe Tax) před ostrým provozem.
- **Možné rozšíření:** roční cena = druhý Price ID + drobná úprava checkoutu.

