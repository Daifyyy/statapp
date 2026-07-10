// Balanc hry na JEDNOM místě. Mapování „síla útoku/obrany → λ", zápasové plány,
// countery, morálka a rozptyl sil ligy. Ladí se výhradně tady; cíl je realistický
// rozptyl ligy (mistr ~2.2/0.8, dno ~1.0/1.8) a náročnost (favorit ať vyhraje častěji,
// ale trenérovo rozhodnutí ať znatelně hýbe λ). Referencí jsou profily v mock/seed.ts.
//
// POZOR – stav ladění (podobně jako LAMBDA_SHARPEN v predict.ts): tyto konstanty jsou
// RUČNĚ odhadnuté/empiricky vyzkoušené na malém počtu odehraných sezón (řádově desítky,
// ne stovky), NE statisticky kalibrované na velkém objemu dat. Empirická čísla v CLAUDE.md
// (mistr ~80 b, poslední ~26 b, adaptivní plán ~+2.4 b/sezónu) jsou orientační ověření
// směru, ne přesná kalibrace. Než tyto hodnoty měnit na základě "pocitu" z pár her, počkej
// na větší vzorek odehraných karier (desítky+) napříč různými hráči.

import type { EuropeSpot, OppStyle, Plan } from "./types";

/** Meze λ (očekávané góly) – stejné jako predikční jádro, pojistka proti extrémům. */
export const MIN_LAMBDA = 0.2;
export const MAX_LAMBDA = 5;

/** Dixon–Coles ρ (korekce nízkých skóre) – publikovaný default jako v predict.ts. */
export const DC_RHO = -0.13;

/** Rozsah generovaných ratingů ligy (od nejsilnějšího po nejslabší tým). */
export const ATTACK_MIN = 0.95;
export const ATTACK_MAX = 2.35;
export const DEFENSE_BEST = 0.75; // nejlepší obrana (nejnižší obdržené)
export const DEFENSE_WORST = 1.85; // nejhorší obrana

// ───────────────────────── domácí výhoda ─────────────────────────
//
// `homeBoost` = poměr reálných gólů (domácí góly/zápas ÷ celkové góly/zápas); u mocku náhodný.
// Ve `matchLambdas` se převede na ADITIVNÍ posun λ v gólech (`homeAdvantage`):
//   λ domácích += (homeBoost−1) × HOME_ADV_SCALE
//   λ hostů    -= (homeBoost−1) × HOME_ADV_SCALE × HOME_DEFENSE_SHARE
//
// Historie (obojí změřeno, ne odhadnuto):
//  • Původně existoval jen násobič útoku domácích a žádné škálování → liga dávala domácím
//    +2,5 p.b. (38,6/25,3/36,1) místo reálných ~+15. Vzorec `λ = (útok + soupeřova obrana)/2`
//    každý násobič na jednom sčítanci navíc půlí.
//  • Multiplikativní oprava (útok ×mult, obdržené ÷mult) sice trefila 45/25/30, ale zavedla
//    strukturální nerovnováhu: doma se útok NÁSOBIL a obrana DĚLILA, takže `∂λ/∂útok` bylo
//    zesílené a `∂λ/∂obrana` tlumené → bod do útoku +1.16 b/sezónu vs bod do obrany +0.84,
//    a žádná hodnota `DEV_DEFENSE_STEP` to nespravila (grid 0.08/0.10/0.12).
//  • Aditivní posun λ má `∂λ/∂rating = 1/2` pro obě strany i oba typy zápasů → parita
//    (+1.02 vs +0.95). Navíc sedí na to, jak se domácí výhoda reálně měří (~+0,35 gólu),
//    a dá i realističtější počet gólů (⌀ 3,02 vs 3,10).

/** Rozsah homeBoost generovaný pro fiktivní (mock) ligu. */
export const HOME_BOOST_MIN = 1.05;
export const HOME_BOOST_MAX = 1.15;

/**
 * **Tvrdý strop na `homeBoost`** – JEDINÝ zdroj pravdy. Platí pro odvození z reálné tabulky,
 * pro investice do stadionu i jako pojistka ve `matchLambdas`. Reálné kluby se drží pod ~1.25
 * (domácí góly/zápas ÷ celkové góly/zápas), takže výš pouštět nemá smysl: `homeBoost` 1.25
 * je +0.50 gólu k λ v každém domácím zápase. Viz `DEV_STADIUM_STEP`.
 */
export const HOME_BOOST_CAP = 1.25;
/** `homeBoost`, když neznáme home split (mezisezóna, chybějící data). */
export const HOME_BOOST_FALLBACK = 1.1;

/**
 * Převod relativní domácí síly (`homeBoost − 1`) na GÓLY přičtené k λ domácích.
 * Laděno gridem přes VŠECHNY uspořádané dvojice generované ligy (= přesně to, co dvoukolový
 * round-robin odehraje) na reálný rozklad 1X2 ~45/25/30. Typický tým (`homeBoost` 1.10)
 * dostane +0.20 gólu, silně domácí (1.25) +0.50 – řádově sedí na měřenou realitu (~+0.35).
 */
export const HOME_ADV_SCALE = 2.0;
/**
 * Kolik z domácí výhody se ODEČTE hostům (0 = domácí jen víc dají, 1 = symetricky).
 * Doma se nejen víc dává, ale soupeř i míň skóruje. Bez tohohle kanálu se na 45/25/30 dostat
 * NEJDE: i při `scale = 4.0` a `share = 0` dá liga jen 46,3 % domácích výher a ⌀ gólů vyletí
 * na 3,36 (samotné přidávání gólů hýbe hlavně skóre, ne výsledkem).
 * `scale = 2.0, share = 0.7` → 44,7/24,9/30,4 při ⌀ 3,02 gólu.
 */
export const HOME_DEFENSE_SHARE = 0.7;

/**
 * Rozptyl sil ligy: násobí odchylku ratingu od ligového průměru (`amplifySpread`).
 * >1 = mistr silnější a dno slabší → favorit dominuje realističtěji, hráč to nemá zadarmo.
 */
export const SPREAD = 1.35;

// Meze po roztažení rozptylu (amplifySpread) – širší než generační rozsah, ať SPREAD
// nekomprimuje špičku zpět (λ je stejně stropované MAX_LAMBDA).
export const SPREAD_ATTACK_MIN = 0.4;
export const SPREAD_ATTACK_MAX = 3.4;
export const SPREAD_DEFENSE_MIN = 0.4;
export const SPREAD_DEFENSE_MAX = 3.2;

/** Shrinkage konstanta pro odhad ratingu z malého vzorku zápasů (`shrink` v teams.ts). */
export const SHRINK_K = 3;

/**
 * Mezisezónní drift ratingu (`driftTeams` v career.ts): regrese ke skutečnému průměru
 * ligy + náhodný šum, ať pořadí sil mezi sezónami mírně kolísá. Drift **zachovává
 * rozptyl** ligy (renormalizace) – nesmí volat `amplifySpread`, ten je jen pro čerstvě
 * postavenou ligu. Dřív se spread násobil 1.35× každou sezónu, regrese ho vracela jen
 * 0.9× → liga se za ~10 sezón polarizovala do clampů (std útoku 0.56 → 0.91).
 */
export const DRIFT_REGRESSION = 0.1;
export const DRIFT_NOISE = 0.25;

/**
 * Výkonová zpětná vazba AI týmů mezi sezónami: kdo přeplnil očekávání, mírně posílí,
 * kdo podlezl, oslabí. Násobí normalizovanou odchylku (očekávaná − skutečná příčka).
 */
export const DRIFT_PERFORMANCE = 0.06;

// ───────────────────────── rozvoj klubu (Phase B) ─────────────────────────

/** Strop rozvojových bodů za sezónu (`developmentPoints`). */
export const MAX_DEV_POINTS = 6;
/** Kolik bodů max. dá samotné umístění v tabulce (percentil × tohle). */
export const DEV_RANK_POINTS = 3;
export const DEV_OBJECTIVE_POINTS = 1;
export const DEV_TITLE_POINTS = 2;
export const DEV_EUROPE_POINTS = 1;
export const DEV_RELEGATION_POINTS = -2;
/** Reputace, od které klub přitahuje investory (+1 bod). */
export const DEV_REPUTATION_THRESHOLD = 65;

/**
 * Zisk za 1 bod investice. Laděno `npm run sim-game` (kariéry ze středu 20týmové ligy):
 *   0.03 / 0.025 → medián titulu 10. sezóna (moc pomalé – mezisezónní regrese sežrala
 *                  skoro celý roční zisk),
 *   0.08 / 0.08  → Ø příčka 9.8 → 5.2 (S5) → 2.3 (S8), do Evropy kolem 5.–6. sezóny,
 *                  medián prvního titulu 6.–7. sezóna.
 * Výš už nejít: 6 bodů (strop) čistě do útoku je +0.48, tj. skoro celá směrodatná odchylka
 * ligy — a to má být „silná sezóna", ne „z průměru rovnou top tým". Průměrná sezóna dá 3–4
 * body, takže reálný roční posun je ~+0.15 na skóre síly.
 */
export const DEV_ATTACK_STEP = 0.08;
/**
 * Obrana má STEJNÝ krok jako útok: `λ = (útok + soupeřova obrana) / 2`, takže bod do útoku
 * zvedne tvoje λ o `step/2` a bod do obrany srazí soupeřovo λ o `step/2` → λ-parita.
 * Při 0.065 byl útok o ~70 % výnosnější.
 *
 * Krok sám o sobě parity nedosáhne – musí ji umožnit i model domácí výhody. Dokud byla
 * multiplikativní (útok ×mult, obdržené ÷mult), bylo `∂λ/∂útok` doma zesílené a `∂λ/∂obrana`
 * tlumené, takže útok vydělával +1.16 vs +0.84 bodu za sezónu bez ohledu na krok (ověřeno
 * gridem 0.08/0.10/0.12). Aditivní domácí výhoda (`homeAdvantage`) to srovnala na +1.02
 * vs +0.95. Zbytek rozdílu je nelinearita Poissona + to, že `DEV_LEAGUE_CEILING` dá
 * průměrnému týmu víc prostoru v útoku (14 bodů) než v obraně (10) – obrana je zdola
 * omezená nulou, útok shora ničím. To je fyzikální, ne chyba.
 */
export const DEV_DEFENSE_STEP = 0.08; // obrana: nižší = lepší, odečítá se
/**
 * Stadion (`homeBoost`) je **pomalá, konečná, ale trvalá** investice. Na rozdíl od útoku
 * a obrany ho mezisezónní drift NEREGREDUJE ke střední hodnotě → jednou koupené zůstane.
 * Proto nejmenší krok a společný strop `HOME_BOOST_CAP`.
 *
 * Změřeno proti skutečnému `matchLambdas` (průměrný tým, 19+19 zápasů, mezní hodnota 1 bodu):
 *   útok +1.02 b/sezónu · obrana +0.95 · stadion +0.43 (zato navždy)
 * Cesta 1.10 → 1.25 stojí 15 bodů (≈ 4 sezóny) a dá +6.2 b/sezónu natrvalo; pak je stadion
 * hotový a další body by propadly (UI je proto nepustí přidat).
 * Původních 0.02/bod dávalo +0.85 b, tedy skoro jako obrana — a to při nulové regresi.
 * Nezvyšovat bez nového měření (`npm run sim-game`, sekce 4).
 */
export const DEV_STADIUM_STEP = 0.01; // homeBoost za bod
/** Mládež: každý bod ubere z mezisezónní regrese tvého klubu (drží dosažený zisk). */
export const DEV_YOUTH_MAX = 5;
export const DEV_YOUTH_REGRESSION_CUT = 0.015;

/**
 * Strop vůči lize: tvůj rating nesmí jednou investicí přeskočit špičku ligy o víc než
 * tenhle poměr. Bez toho by šlo z průměru udělat superklub za pár sezón.
 */
export const DEV_LEAGUE_CEILING = 1.05;

// ───────────────────────── kondice (Phase B) ─────────────────────────

/** Kondice 0–100, start 100. Náročné plány unavují, pasivní regenerují. */
export const STARTING_FITNESS = 100;
export const FITNESS_RECOVERY = 5;
/**
 * `counter` má stejnou únavu jako `balanced`. Dřív měl 2 (tj. regeneroval rychleji) a
 * zároveň lepší základ λ → dominoval „Vyvážený" na VŠECH osách. `low_block` (0) zůstává
 * jediným regeneračním plánem – tím se za pasivitu platí i vyplácí.
 */
export const PLAN_FATIGUE: Record<Plan, number> = {
  balanced: 3,
  open: 8,
  low_block: 0,
  press: 8,
  counter: 3,
};
/** Maximální postih λ při nulové kondici (plná kondice = bez postihu, nikdy bonus). */
export const FITNESS_PENALTY = 0.1;

// ───────────────────────── scouting / instrukce (Phase B) ─────────────────────────
//
// Konfidence scoutingu je **spojitá škála od mlhy k jistotě**, ne konstanta. Dřív byla
// fixních 0.75 (a event ji zvedl na 0.95) → hlášení se nikdy nezměnilo a scouting byl
// jen dekorace. Teď roste s tím, co o soupeři reálně můžeš vědět:
//
//   confidence = MIN + vzorek + známost + investice   (strop MAX, event → rovnou MAX)
//
// Na startu sezóny nikdo nic neodehrál → mlha; v odvetě proti známému týmu → jistota.
// V turnaji to vychází samo (soupeř má 0–3 zápasy) bez jediné speciální větve.

/** Konfidence pro úplně neznámého soupeře (start sezóny, nulový vzorek). */
export const SCOUT_CONFIDENCE_MIN = 0.45;
/** Strop konfidence – ani zaplacená analýza nedá jistotu. */
export const SCOUT_CONFIDENCE_MAX = 0.95;
/** Konfidence po investici do skautingu (event) – nastaví se rovnou na strop. */
export const SCOUT_CONFIDENCE_BOOSTED = SCOUT_CONFIDENCE_MAX;
/** Kolik odehraných zápasů soupeře už dá plný vzorkový příspěvek. */
export const SCOUT_SAMPLE_FULL = 6;
/** Maximální příspěvek vzorku ke konfidenci. */
export const SCOUT_SAMPLE_WEIGHT = 0.25;
/** Skokový bonus, když jste se v téhle sezóně/turnaji už potkali (odveta). */
export const SCOUT_FAMILIARITY_BONUS = 0.08;

/**
 * Investice do skautského oddělení (5. rozvojová oblast). **Nesahá na λ** – kupuje si
 * informaci, ne sílu. Celý strop (5 bodů ≈ 1,5 sezóny rozpočtu) koupí +0.20 konfidence:
 * znatelné (posune tě o kvalitativní stupeň dřív), ale bodově nekonkurenceschopné vůči
 * útoku/obraně. Skauting je pojistka, ne dominantní strategie.
 * ⚠️ `npm run sim-game` sekce 4 to NEZMĚŘÍ (žádný λ efekt) – ladí se playtestem.
 */
export const SCOUT_LEVEL_STEP = 0.04;
export const SCOUT_LEVEL_MAX = 5;

/**
 * Prahy kvality hlášení (viz `ScoutQuality` ve `scouting.ts`). Pod `VAGUE` skauti styl
 * vůbec neurčí; nad `DETAILED` vidí všechno a doporučí protitah.
 */
export const SCOUT_QUALITY_VAGUE = 0.6;
export const SCOUT_QUALITY_DETAILED = 0.85;

/**
 * Jak výrazný musí trait být, aby ho skauti při dané kvalitě vůbec zmínili (0–1, viz
 * `traitStrength` ve scouting.ts). `detailed` odhalí všechny. Skryté traity **pořád platí**
 * (`resolveInstruction` čte pravdu) – proto je instrukce sázka, ne jistota.
 */
export const SCOUT_REVEAL_VAGUE = 0.6;
export const SCOUT_REVEAL_STANDARD = 0.25;

/** Efekt vedlejší instrukce – záměrně menší než counter plánu (±10 %). */
export const INSTRUCTION_BONUS = 0.05;
export const INSTRUCTION_PENALTY = 0.02;

// ───────────────────────── manažerská agency (Phase 2) ─────────────────────────

/**
 * Základní efekt zápasového plánu na tvůj tým. `attack` = násobič vstřelených,
 * `concede` = násobič OBDRŽENÝCH (>1 = dostáváš víc). `balanced` = přesný no-op.
 * Countery proti stylu soupeře se násobí zvlášť (`COUNTER_MATRIX` níže).
 *
 * `counter` platí GÓLY za solidnost (0.94/0.90). Dřív měl 1.02/0.90, což je zdarma lepší
 * než `balanced` (1.0/1.0) v obou osách – a spolu s nižší únavou (2 vs 3) tak „Vyvážený"
 * dominoval ve všech situacích. Cenu proto nese ÚTOK, ne obrana: `concede` zůstává na 0.90.
 * Snížení na 0.88 zkoušeno – posunulo podlahu (0.88 × counter 0.90 × morálka × instrukce ×
 * event) pod `ADJUST_MIN` a `sim-game` sekce 3 vyskočila z 0.1 % na 0.28 % clampnutých zápasů.
 * Kryto testem „žádný plán nedominuje balanced".
 */
export const PLAN_BASE: Record<Plan, { attack: number; concede: number }> = {
  balanced: { attack: 1.0, concede: 1.0 },
  open: { attack: 1.15, concede: 1.15 }, // otevřená hra: víc dáš i dostaneš
  low_block: { attack: 0.82, concede: 0.8 }, // nízký blok: zavři obranu, míň dáš
  press: { attack: 1.08, concede: 1.05 }, // presink: aktivní, mírné riziko vzadu
  counter: { attack: 0.94, concede: 0.9 }, // kontry: pevná obrana, oportunní útok
};

/**
 * Mez, ve které musí ležet každá buňka `COUNTER_MATRIX`. Není to násobič (jako dřív
 * `COUNTER_BONUS`/`COUNTER_PENALTY`), ale **dokumentovaný rozpočet counteru** – strážený
 * testem. Bez něj by prohlubování matice tiše nafouklo efekt a začalo trefovat clamp
 * `ADJUST_MIN/MAX` (viz komentář u něj níže).
 */
export const COUNTER_MAX_EFFECT = 0.12;

/**
 * Counter: efekt plánu proti STYLU soupeře. Násobí `PLAN_BASE`.
 * `atk > 1` a `conc < 1` jsou pro tebe dobré.
 *
 * Dřív to byla funkce, která vracela jednu ze čtyř šablon (`up`/`down`/`risk`/`toothless`)
 * a `balanced` necountroval vůbec. Explicitní tabulka dá každé dvojici vlastní tvar –
 * `press` a `open` rozebírají zataženého soupeře jinak (press přes obranu, open přes útok),
 * `low_block` a `counter` ustojí tlak jinak. Řádek `balanced` je záměrně samá 1.0: je to
 * bezpečná volba bez counteru, ne zapomenutý řádek.
 */
export const COUNTER_MATRIX: Record<
  Plan,
  Record<OppStyle, { atk: number; conc: number }>
> = {
  balanced: {
    attacking: { atk: 1.0, conc: 1.0 },
    defensive: { atk: 1.0, conc: 1.0 },
    balanced: { atk: 1.0, conc: 1.0 },
  },
  open: {
    attacking: { atk: 1.02, conc: 1.12 }, // divoká přestřelka – jde to hlavně na tebe
    defensive: { atk: 1.12, conc: 1.0 }, // otevři zataženého
    balanced: { atk: 1.0, conc: 1.03 },
  },
  low_block: {
    attacking: { atk: 0.95, conc: 0.88 }, // ustojíš tlak, ale nemáš čím trestat
    defensive: { atk: 0.9, conc: 1.0 }, // dva zatažené týmy = nuda, ztrácíš čas
    balanced: { atk: 1.0, conc: 0.98 },
  },
  press: {
    attacking: { atk: 1.0, conc: 1.1 }, // presovat útočný tým = díry za obranou
    defensive: { atk: 1.1, conc: 0.98 }, // rozeber pasivní tým vysokým blokem
    balanced: { atk: 1.0, conc: 1.02 },
  },
  counter: {
    attacking: { atk: 1.12, conc: 0.9 }, // trestej otevřeného – ideální protitah
    defensive: { atk: 0.88, conc: 0.98 }, // není co chytat, zbytečně čekáš
    balanced: { atk: 1.0, conc: 0.97 },
  },
};

/** Morálka: rozkyv λ (±) při morálce 0 vs 100 oproti neutrálním 50. */
export const MORALE_SWING = 0.06;
export const STARTING_MORALE = 50;

/**
 * Vývoj morálky po zápase (`updateMorale` v morale.ts): základní posun dle výsledku
 * (výhra/prohra/remíza), bonus/postih za překvapivý výsledek (výhra nad silnějším /
 * prohra se slabším), a pomalá regrese ke středu (50), ať se morálka nezasekne.
 */
export const MORALE_OUTCOME_DELTA = { win: 8, loss: -8, draw: 1 };
export const MORALE_SURPRISE_BONUS = 5;
export const MORALE_DRIFT = 0.05;

/**
 * Prahy scoutingu soupeře (`scoutOpponent` v scouting.ts): jak velký rozdíl
 * útok/obrana oproti ligovému průměru už znamená "attacking"/"defensive" styl nebo
 * trait (silný útok/děravá obrana/pevná obrana), a jak velký rozdíl síly = favorit/outsider.
 */
export const SCOUT_STYLE_GAP = 0.1;
export const SCOUT_TRAIT_RATIO_HIGH = 1.1;
export const SCOUT_TRAIT_RATIO_LOW = 0.9;
export const SCOUT_STRENGTH_GAP = 0.25;

/**
 * Měkký strop na KOMBINOVANÉ stohování plán × counter × morálka × eventové modifikátory
 * (`resolveAdjust` v engine.ts). Bez něj by "perfektní bouře" (správný counter + morálka
 * 100 + stacknuté eventy) mohla poslat attack/concede mimo rozumný rozsah, i když každý
 * systém sám o sobě je odladěný na menší výkyv. `MIN_LAMBDA`/`MAX_LAMBDA` chrání jen
 * konečnou λ, ne tento mezikrok.
 */
export const ADJUST_MIN = 0.7;
export const ADJUST_MAX = 1.4;

/** Šance, že v kole nastane náhodný event (deterministicky dle seedu+kola). */
export const EVENT_CHANCE = 0.3;

// ───────────────────────── turnaj (Phase 4) ─────────────────────────

// Pozn.: turnajové pole se ZÁMĚRNĚ neroztahuje `amplifySpread`. `SPREAD` (1.35) je
// kalibrovaný pro 20týmovou ligu s velkým rozdílem mezi mistrem a dnem; pole reprezentací
// je už shora seříznuté kvalifikací a jeho ratingy jdou z reálných dat, takže rozptyl v nich
// je. Roztažení by z Brazílie udělalo nezastavitelný stroj a z Nového Zélandu terč.

/**
 * Prodloužení: 2×15 min z 90 → λ se násobí `30/90`. Škáluje se celá λ včetně domácího
 * bonusu (`matchLambdas(…, lambdaScale)`), ne jen ratingy.
 */
export const EXTRA_TIME_LAMBDA = 30 / 90;

/**
 * Penaltový rozstřel: šance silnějšího týmu. `0.5` = čistý los, výš = útočná kvalita
 * rozhoduje. Reálně je rozstřel skoro coin-flip, proto jen mírné vychýlení.
 * `p(A) = 0.5 + PENALTY_ATTACK_WEIGHT × (attackA − attackB)`, clampnuto na `±PENALTY_MAX_EDGE`.
 */
export const PENALTY_ATTACK_WEIGHT = 0.08;
export const PENALTY_MAX_EDGE = 0.1;

// ───────────────────────── reprezentační kvalifikace (Phase 4 / T4) ─────────────────────────
//
// Kvalifikace je vědomé ZJEDNODUŠENÍ reálných (cyklus od cyklu se měnících) formátů: hráč
// hraje JEDNU kvalifikační skupinu své konfederace dvoukolově (doma/venku – tady `homeBoost`
// konečně dává smysl a použije se, ne 1). Postoupí, když skončí do `QUAL_ADVANCE`. místa.
// Zbytek závěrečného pole (ostatní konfederace + doplnění tvé) obsadí LOS VÁŽENÝ RATINGEM.

/** Velikost kvalifikační skupiny hráče (sudá kvůli dvoukolovému round-robinu). */
export const QUAL_GROUP_SIZE = 6;
/** Kolik prvních míst skupiny postupuje na závěrečný turnaj. */
export const QUAL_ADVANCE = 3;
/**
 * Domácí výhoda v kvalifikaci: reprezentace mají ve snapshotu `homeBoost: 1` (turnaj =
 * neutrál), ale kvalifikace se hraje doma/venku → dáme jim společný fallback, ať prostředí
 * na λ vůbec zabere. Pořadatelský efekt závěrečného turnaje sdílí totéž číslo.
 */
export const QUAL_HOME_BOOST = HOME_BOOST_FALLBACK;

// ───────────────────────── klubový pohár (reputace) ─────────────────────────

/** Reputace za samotnou účast v poháru (analogie `TOURN_QUALIFY_REP`). */
export const CUP_PARTICIPATE_REP = 3;
/** Bonus za vítězství v poháru (nad rámec `TOURN_STAGE_REP` nejdál dosažené fáze). */
export const CUP_CHAMPION_REP = 8;
// Fáze (`TOURN_STAGE_REP` níže) se sdílí s reprezentačním turnajem – stejný `Stage` typ
// (`tournament.ts`), stejná logika "jak daleko ses dostal". Ladí se dohromady.

// ───────────────────────── reprezentační reputace (Phase 4 / T5) ─────────────────────────

/** Reputace za neúspěch v kvalifikaci (nedostal ses na turnaj). */
export const TOURN_MISS_REP = -5;
/** Reputace za samotný postup na závěrečný turnaj. */
export const TOURN_QUALIFY_REP = 3;
/** Bonus za vítězství v turnaji (nad rámec dosažení finále). */
export const TOURN_CHAMPION_REP = 8;
/**
 * Reputace za nejdál dosaženou fázi (kumulativní se `QUALIFY` + případně `CHAMPION`).
 * `final` = finalista; mistr dostane navíc `TOURN_CHAMPION_REP`.
 */
export const TOURN_STAGE_REP: Record<string, number> = {
  group: 0,
  r32: 1,
  r16: 2,
  qf: 4,
  sf: 6,
  final: 8,
  done: 0,
};

// ───────────────────────── kariéra (Phase 1C) ─────────────────────────

/** Reputace nového profilu na startu kariéry (gatuje výběr prvního klubu). */
export const STARTING_REPUTATION = 30;

/**
 * Reputace po sezóně (`updateReputation` v reputation.ts): bonus za evropskou příčku
 * (základní fáze > předkolo), titul, sestup, splnění cíle + over/under-performance vůči
 * očekávanému umístění (clamp ± `REP_PERF_CLAMP`, váha `REP_PERF_WEIGHT`).
 */
export const EUROPE_REP: Record<EuropeSpot, number> = {
  UCL: 6,
  UCL_Q: 4,
  UEL: 3,
  UEL_Q: 2,
  UECL: 2,
  UECL_Q: 1,
  NONE: 0,
};
export const CHAMPION_REP = 6;
export const RELEGATION_REP = -12;

/**
 * Strop reputace daný ÚROVNÍ týmu, který zrovna vedeš: kladné přírůstky reputace nemůžou
 * vytlačit reputaci nad `prestiž týmu + tenhle margin`. Bez toho by šlo vybudovat elitní
 * reputaci sérií titulů se slabým klubem (Sparta, globálně nízká úroveň) a hned převzít
 * Španělsko. Se stropem se k elitě musíš propracovat přes silnější klub/reprezentaci.
 * Záporné změny platí vždy; kdo spadl pod svou úroveň o reputaci nepřijde, jen neroste.
 * Ladicí konstanta – ověřit playtestem (sim-game reputaci mezi ligami neměří).
 */
export const REP_CEILING_MARGIN = 12;
export const PROMOTION_REP = 8;
export const OBJECTIVE_MET_REP = 3;
export const REP_PERF_CLAMP = 10;
export const REP_PERF_WEIGHT = 0.6;

/**
 * Spodní patro job marketu (pojistka proti uvíznutí kariéry): kluby s prestiží ≤ tohoto
 * prahu si tě najmou VŽDY, bez ohledu na reputaci ("nejmenší ryba vezme kohokoliv").
 * Zajišťuje, že i po několika sestupech za sebou existuje klub, který můžeš vzít –
 * kariéra nikdy neskončí ve slepé uličce. Kryje nejslabší kluby malých lig i 2. ligy.
 */
export const MIN_HIREABLE_PRESTIGE = 40;

/** Posun/rozsah prestiže týmu v rámci ligy (`teamPrestige` v leagues.ts). */
export const PRESTIGE_SHIFT = -18;
export const PRESTIGE_SCALE = 34;

/**
 * O kolik příček pod postupovou zónou 2. ligy ještě zní sezónní cíl jako „zabojuj
 * o postup" (`seasonObjective`). Dál už je to jen potvrzení síly.
 */
export const PROMOTION_PUSH_GAP = 4;
