"use client";

import { memo, useState } from "react";
import { TeamLogo } from "../TeamLogo";
import { teamById } from "@/lib/game/teams";
import { careerStats } from "@/lib/game/career";
import { updateReputation, expectedRank, HIRE_MARGIN } from "@/lib/game/reputation";
import {
  teamPrestige,
  seasonHeadline,
  seasonTone,
  leagueName as leagueNameFor,
} from "@/lib/game/leagues";
import { emptyProfile } from "@/lib/game/profile";
import { ALL_ACHIEVEMENTS } from "@/lib/game/achievements";
import type { AchievementTier } from "@/lib/game/achievements";
import { COMPETITIONS, nationOptions, STAGE_LABEL } from "@/lib/game/nationalCompetitions";
import type { CompetitionId } from "@/lib/game/nationalCompetitions";
import { STARTING_REPUTATION } from "@/lib/game/balance";
import type {
  CupSummary,
  EarnedAchievement,
  ManagerProfile,
  SaveState,
  SeasonState,
  SeasonSummary,
  TournamentSummary,
} from "@/lib/game/types";

/**
 * Klastr "profil manažera": vstupní hub, výběr reprezentace, kariérní rekordy,
 * historie sezón/turnajů a achievementy. Vytknuto z `HraApp.tsx` (byl 3700+ řádků
 * v jednom souboru) – všechny funkce tady jsou vzájemně provázané (ProfilePanel
 * skládá HistoryView/AchievementsGrid/EngagementNote dohromady), ale nezávislé
 * na zbytku hry (sezóna/turnaj), proto tvoří samostatný modul.
 */

function repTier(r: number): string {
  if (r >= 85) return "Elitní trenér";
  if (r >= 65) return "Zvučné jméno";
  if (r >= 45) return "Zavedený";
  if (r >= 25) return "Nadějný";
  return "Začínající";
}

/**
 * Reputační zisk/ztráta za každou sezónu = přehrání od STARTING_REPUTATION
 * (deterministické, shodné s tím, jak reputace reálně narůstala během kariéry).
 */
function reputationDeltas(history: SeasonSummary[]): number[] {
  let rep = STARTING_REPUTATION;
  return history.map((h) => {
    const after = updateReputation(rep, h);
    const d = after - rep;
    rep = after;
    return d;
  });
}

export const HistoryView = memo(function HistoryView({ save }: { save: SaveState }) {
  const stats = careerStats(save.history);
  if (!stats) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center text-sm text-muted">
        Zatím žádná dohraná sezóna. Dohraj tu aktuální a objeví se tu tvá kariéra.
      </div>
    );
  }
  return (
    <div className="mt-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <StatTile label="Sezón" value={stats.seasons} />
        <StatTile label="Titulů" value={stats.titles} accent />
        <StatTile label="Poháry" value={stats.europeanQualifs} />
        <StatTile label="Postupy" value={stats.promotions} />
        <StatTile label="Sestupy" value={stats.relegations} />
        <StatTile label="Ø vstř." value={stats.avgGoalsFor.toFixed(2)} />
        <StatTile label="Ø obdr." value={stats.avgGoalsAgainst.toFixed(2)} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <StatTile label="Nejlepší" value={`${stats.bestRank}.`} />
        <StatTile label="Průměr" value={`${stats.avgRank}.`} />
        <StatTile label="Čistá konta" value={stats.cleanSheets} />
        <StatTile label="Výhry" value={stats.totalWin} />
        <StatTile label="Remízy" value={stats.totalDraw} />
        <StatTile label="Prohry" value={stats.totalLoss} />
        <StatTile label="Ø PPG" value={stats.avgPPG.toFixed(2)} />
      </div>

      <h3 className="mt-4 text-xs font-semibold text-foreground">Odehrané sezóny</h3>
      <SeasonRows history={save.history} />
    </div>
  );
});

/** Seznam odehraných klubových sezón (nejnovější první) – sdílené HistoryView i ProfilePanel. */
function SeasonRows({ history }: { history: SeasonSummary[] }) {
  const repDeltas = reputationDeltas(history);
  return (
    <div className="mt-2 space-y-1.5">
      {[...history].reverse().map((h, i) => {
        const tone = seasonTone(h);
        const toneClass =
          tone === "good"
            ? "bg-positive/15 text-positive"
            : tone === "bad"
              ? "bg-negative/15 text-negative"
              : "bg-border/60 text-muted";
        const delta = repDeltas[history.length - 1 - i];
        return (
          <div
            key={`${h.season}-${h.leagueId}-${h.yourTeamId}-${i}`}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            <span className="w-8 shrink-0 text-xs text-muted">S{h.season}</span>
            <span className="w-7 shrink-0 text-xs text-muted">{h.yourRank}.</span>
            {/* Klub jen logem – název je v title/alt, řádek zůstane úzký i na mobilu. */}
            <span className="shrink-0" title={h.yourName}>
              <TeamLogo src={h.yourLogo} alt={h.yourName} size={18} />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{h.leagueName}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted" title="Body na zápas">
              {(h.yourPoints / (h.win + h.draw + h.loss)).toFixed(2)} PPG
            </span>
            <RepDelta delta={delta} />
            <span
              className={"shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold " + toneClass}
            >
              {seasonHeadline(h)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Hlavní odznak reprezentačního běhu (mistr / finalista / fáze / nekvalifikace). */
function tournamentHeadline(t: TournamentSummary): { text: string; tone: "good" | "ok" | "bad" } {
  if (t.champion) return { text: "Mistr 🏆", tone: "good" };
  if (!t.qualified) return { text: "Nekvalifikace", tone: "bad" };
  if (t.stageReached === "final") return { text: "Finalista 🥈", tone: "good" };
  if (t.stageReached === "sf") return { text: STAGE_LABEL.sf, tone: "good" };
  if (t.stageReached === "group") return { text: "Skupina", tone: "ok" };
  return { text: STAGE_LABEL[t.stageReached as keyof typeof STAGE_LABEL] ?? "—", tone: "ok" };
}

/** Seznam dohraných reprezentačních turnajů (nejnovější první). */
function TournamentRows({ history }: { history: TournamentSummary[] }) {
  return (
    <div className="mt-2 space-y-1.5">
      {[...history].reverse().map((t, i) => {
        const h = tournamentHeadline(t);
        const toneClass =
          h.tone === "good"
            ? "bg-positive/15 text-positive"
            : h.tone === "bad"
              ? "bg-negative/15 text-negative"
              : "bg-border/60 text-muted";
        const comp = COMPETITIONS[t.competitionId as CompetitionId];
        return (
          <div
            key={`${t.competitionId}-${t.edition}-${t.teamId}-${i}`}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            <span className="w-6 shrink-0 text-center text-sm" title={comp?.name ?? t.competitionName}>
              {comp?.emoji ?? "🏆"}
            </span>
            <span className="shrink-0" title={t.teamName}>
              <TeamLogo src={t.teamLogo} alt={t.teamName} size={18} />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{t.teamName}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted">
              {t.win}-{t.draw}-{t.loss}
            </span>
            <span
              className={"shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold " + toneClass}
            >
              {h.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Hlavní odznak dohraného klubového poháru (mistr / finalista / fáze). */
function cupHeadline(c: CupSummary): { text: string; tone: "good" | "ok" | "bad" } {
  if (c.champion) return { text: "Mistr 🏆", tone: "good" };
  if (c.stageReached === "final") return { text: "Finalista 🥈", tone: "good" };
  if (c.stageReached === "sf") return { text: STAGE_LABEL.sf, tone: "good" };
  if (c.stageReached === "group") return { text: "Skupina", tone: "ok" };
  return { text: STAGE_LABEL[c.stageReached as keyof typeof STAGE_LABEL] ?? "—", tone: "ok" };
}

/** Seznam dohraných klubových pohárů (nejnovější první). */
function CupRows({ history }: { history: CupSummary[] }) {
  return (
    <div className="mt-2 space-y-1.5">
      {[...history].reverse().map((c, i) => {
        const h = cupHeadline(c);
        const toneClass =
          h.tone === "good"
            ? "bg-positive/15 text-positive"
            : h.tone === "bad"
              ? "bg-negative/15 text-negative"
              : "bg-border/60 text-muted";
        return (
          <div
            key={`${c.cupId}-${c.edition}-${c.teamId}-${i}`}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            <span className="w-8 shrink-0 text-xs text-muted">S{c.season}</span>
            <span className="shrink-0" title={c.teamName}>
              <TeamLogo src={c.teamLogo} alt={c.teamName} size={18} />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{c.teamName}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted">
              {c.win}-{c.draw}-{c.loss}
            </span>
            <span
              className={"shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold " + toneClass}
            >
              {h.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Reputační zisk/ztráta za sezónu (barevný odznak). */
function RepDelta({ delta }: { delta: number }) {
  const cls =
    delta > 0
      ? "bg-positive/15 text-positive"
      : delta < 0
        ? "bg-negative/15 text-negative"
        : "bg-border/60 text-muted";
  return (
    <span
      className={"shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums " + cls}
      title="Změna reputace za sezónu"
    >
      {delta > 0 ? "+" : ""}
      {delta}
    </span>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-2 py-2.5 text-center shadow-sm">
      <div
        className={
          "text-base font-bold tabular-nums " +
          (accent ? "text-warning" : "text-foreground")
        }
      >
        {value}
      </div>
      <div className="text-[10px] text-muted">{label}</div>
    </div>
  );
}

/** Kontext angažmá pro Profil: koho vedeš, prestiž klubu, očekávání a dosah reputace. */
function EngagementNote({
  state,
  reputation,
}: {
  state: SeasonState;
  reputation: number;
}) {
  const you = teamById(state.teams, state.yourTeamId);
  const prestige = teamPrestige(you, state.leagueId, state.teams);
  const exp = expectedRank(you, state.teams);
  const reach = Math.round(reputation) + HIRE_MARGIN;
  return (
    <div>
      <h3 className="text-xs font-semibold text-foreground">Aktuální angažmá</h3>
      <div className="mt-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-xs text-muted">
        <p>
          Vedeš <strong className="text-foreground">{you.name}</strong> ({state.leagueName}) —
          prestiž klubu <strong className="text-foreground">{prestige}</strong>, očekává se{" "}
          <strong className="text-foreground">{exp}. místo</strong>. S reputací tě teď osloví
          kluby do prestiže ~{reach}.
        </p>
        <p className="mt-1">
          Cíl sezóny: <strong className="text-foreground">{state.objective.text}</strong>
        </p>
      </div>
    </div>
  );
}

/** Vstupní rozcestník bez aktivní kariéry: profil + volba režimu (klub / reprezentace). */
export function ManagerHub({
  save,
  managerName,
  onPickClub,
  onPickNation,
}: {
  save: SaveState | null;
  managerName: string | null;
  onPickClub: () => void;
  onPickNation: () => void;
}) {
  const profile = save?.profile ?? emptyProfile();
  return (
    <div>
      <ProfilePanel
        profile={profile}
        reputation={null}
        managerName={managerName}
        activeCareer={false}
        history={save?.history ?? []}
        tournamentHistory={save?.tournamentHistory ?? []}
        cupHistory={save?.cupHistory ?? []}
      />
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onPickClub}
          className="rounded-2xl border border-border bg-surface px-4 py-4 text-left shadow-sm transition hover:border-foreground/30"
        >
          <div className="text-sm font-semibold text-foreground">🏟️ Klubová kariéra</div>
          <div className="mt-0.5 text-[11px] text-muted">
            Veď reálný klub ligou i napříč sezónami (postup, sestup, job market).
          </div>
        </button>
        <button
          type="button"
          onClick={onPickNation}
          className="rounded-2xl border border-border bg-surface px-4 py-4 text-left shadow-sm transition hover:border-foreground/30"
        >
          <div className="text-sm font-semibold text-foreground">🌐 Reprezentace</div>
          <div className="mt-0.5 text-[11px] text-muted">
            Proveď národ kvalifikací až na Euro nebo mistrovství světa.
          </div>
        </button>
      </div>
    </div>
  );
}

/** Výběr soutěže + reprezentace (gated reputací, jako job market u klubů). */
export function NationPicker({
  reputation,
  onStart,
}: {
  reputation: number;
  onStart: (competitionId: CompetitionId, teamId: number) => void;
}) {
  const [competition, setCompetition] = useState<CompetitionId>("EURO");
  const comp = COMPETITIONS[competition];
  // U Eura dává smysl vybírat jen z UEFA (jinak by národ neměl kvalifikaci); u MS všechny.
  const options = nationOptions(reputation).filter(
    (o) => competition === "WC" || o.confed === "UEFA"
  );

  return (
    <div className="mt-4">
      <h2 className="text-sm font-semibold text-foreground">Vyber soutěž</h2>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(Object.keys(COMPETITIONS) as CompetitionId[]).map((id) => {
          const c = COMPETITIONS[id];
          const active = competition === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setCompetition(id)}
              className={
                "rounded-xl border px-3 py-2.5 text-left transition " +
                (active
                  ? "border-foreground/40 bg-foreground/10"
                  : "border-border bg-surface hover:border-foreground/30")
              }
            >
              <div className="text-sm font-semibold text-foreground">
                {c.emoji} {c.name}
              </div>
              <div className="text-[11px] text-muted">
                {c.format.groups * c.format.groupSize} týmů
              </div>
            </button>
          );
        })}
      </div>

      <h2 className="mt-4 text-sm font-semibold text-foreground">
        Vyber reprezentaci — {comp.name}
      </h2>
      <p className="mt-1 text-xs text-muted">
        Zvučnější národy tě vezmou jen s dost vysokou reputací (aktuálně {reputation}). Buduj ji
        úspěchy na turnajích. Pořadatel se kvalifikuje automaticky.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const isHost = o.id === comp.hostId;
          return (
            <button
              key={o.id}
              type="button"
              disabled={!o.hireable}
              onClick={() => onStart(competition, o.id)}
              className={
                "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left shadow-sm transition " +
                (o.hireable
                  ? "border-border bg-surface hover:border-foreground/30"
                  : "border-border/60 bg-surface/40 opacity-60")
              }
            >
              <TeamLogo src={o.logo} alt={o.name} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {o.name}
                  {isHost && <span className="ml-1 text-[10px] text-positive">pořadatel</span>}
                </span>
                <span className="text-[11px] text-muted">prestiž {o.prestige}</span>
              </span>
              {!o.hireable && (
                <span className="shrink-0 text-[11px] text-negative">🔒 mimo dosah</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Manažerský profil: hlavička + kariérní rekordy + klub/repre + achievementy. */
export function ProfilePanel({
  profile,
  reputation,
  managerName,
  activeCareer,
  current,
  history = [],
  tournamentHistory = [],
  cupHistory = [],
}: {
  profile: ManagerProfile;
  reputation: number | null;
  managerName: string | null;
  activeCareer: boolean;
  /** Běžící klubová sezóna – zdroj bloku „Aktuální angažmá". Chybí v repre režimu. */
  current?: SeasonState | null;
  /** Klubové sezóny (aktuální kariéra) – pro historii v přehledu manažera. */
  history?: SeasonSummary[];
  /** Dohrané reprezentační turnaje. */
  tournamentHistory?: TournamentSummary[];
  /** Dohrané klubové poháry. */
  cupHistory?: CupSummary[];
}) {
  const a = profile.allTime;
  const rep = reputation != null ? Math.round(reputation) : null;
  return (
    <div className="mt-3 space-y-4">
      {/* Hlavička */}
      <div className="rounded-xl border border-border bg-surface px-3 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-foreground">
              👔 {managerName || "Trenér"}
            </div>
            <div className="text-xs text-muted">
              {activeCareer && rep != null
                ? `${repTier(rep)} · reputace ${rep}/100`
                : "Bez aktivní kariéry"}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-lg font-bold tabular-nums text-warning">{a.titles}</div>
            <div className="text-[10px] text-muted">titulů celkem</div>
          </div>
        </div>
        {activeCareer && rep != null && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-muted">Reputace</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-border/60">
              <div
                className="bar-fill h-full rounded-full bg-positive"
                style={{ width: `${rep}%` }}
              />
            </div>
            <span className="tabular-nums font-semibold text-foreground">{rep}/100</span>
          </div>
        )}
      </div>

      {current && rep != null && <EngagementNote state={current} reputation={rep} />}

      {/* Kariérní rekordy */}
      <div>
        <h3 className="text-xs font-semibold text-foreground">Kariérní rekordy</h3>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
          <StatTile label="Kariér" value={a.careers} />
          <StatTile label="Sezón" value={a.seasons} />
          <StatTile label="Titulů" value={a.titles} accent={a.titles > 0} />
          <StatTile label="Evr. účastí" value={a.europeanQualifs} />
          <StatTile label="Sestupy" value={a.relegations} />
          <StatTile label="Nejlepší" value={a.bestRank ? `${a.bestRank}.` : "—"} />
          <StatTile label="Max bodů" value={a.bestSeasonPoints || "—"} />
          <StatTile label="Max gólů" value={a.mostGoalsSeason || "—"} />
          <StatTile label="Max reputace" value={a.bestReputation || "—"} />
          <StatTile label="Neporažen" value={a.invincibleSeasons} />
        </div>
      </div>

      {/* Klubová vs reprezentační vs evropská (pohárová) scéna */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
          <div className="text-xs font-semibold text-foreground">🏟️ Klubová scéna</div>
          <p className="mt-1 text-[11px] text-muted">
            {a.seasons > 0
              ? `${a.titles} titulů · ${a.europeanQualifs}× Evropa · ${a.relegations} sestupů`
              : "Zatím žádná odehraná sezóna."}
          </p>
          {a.leaguesCoached.length > 0 && (
            <p className="mt-1 text-[11px] text-muted">
              Ligy: {a.leaguesCoached.map((id) => leagueNameFor(id)).join(", ")}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
          <div className="text-xs font-semibold text-foreground">🌐 Reprezentační scéna</div>
          <p className="mt-1 text-[11px] text-muted">
            {(a.tournamentsPlayed ?? 0) > 0
              ? `${a.majorTitles ?? 0}× velký titul · ${a.finalsReached ?? 0}× finále · ${
                  a.tournamentsPlayed ?? 0
                } turnajů`
              : "Zatím žádný reprezentační turnaj."}
          </p>
          {(a.nationsCoached?.length ?? 0) > 0 && (
            <p className="mt-1 text-[11px] text-muted">
              Vedeno reprezentací: {a.nationsCoached!.length}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
          <div className="text-xs font-semibold text-foreground">🏆 Klubový pohár</div>
          <p className="mt-1 text-[11px] text-muted">
            {(a.cupsPlayed ?? 0) > 0
              ? `${a.cupTitles ?? 0}× titul · ${a.cupsPlayed ?? 0} účastí`
              : "Zatím žádný klubový pohár."}
          </p>
        </div>
      </div>

      {/* Historie – klubové sezóny */}
      {history.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-foreground">Historie sezón (klub)</h3>
          <SeasonRows history={history} />
        </div>
      )}

      {/* Historie – reprezentační turnaje */}
      {tournamentHistory.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-foreground">Historie turnajů (reprezentace)</h3>
          <TournamentRows history={tournamentHistory} />
        </div>
      )}

      {/* Historie – klubové poháry */}
      {cupHistory.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-foreground">Historie klubových pohárů</h3>
          <CupRows history={cupHistory} />
        </div>
      )}

      {/* Achievementy */}
      <AchievementsGrid earned={profile.achievements} />
    </div>
  );
}

function tierClass(tier: AchievementTier): string {
  return tier === "gold"
    ? "border-warning/50 bg-warning/10"
    : tier === "silver"
      ? "border-border bg-surface"
      : "border-away/40 bg-away/10"; // bronze
}

/** Mřížka achievementů: odemčené barevně dle tier, zamčené šedé s popisem. */
const AchievementsGrid = memo(function AchievementsGrid({ earned }: { earned: EarnedAchievement[] }) {
  const owned = new Set(earned.map((e) => e.id));
  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground">Achievementy</h3>
        <span className="text-[11px] text-muted">
          {owned.size}/{ALL_ACHIEVEMENTS.length}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ALL_ACHIEVEMENTS.map((ach) => {
          const has = owned.has(ach.id);
          return (
            <div
              key={ach.id}
              title={ach.desc}
              className={
                "rounded-xl border p-2.5 " +
                (has
                  ? tierClass(ach.tier)
                  : "border-dashed border-border bg-surface/40 opacity-70")
              }
            >
              <div className="flex items-center gap-1.5">
                <span className={"text-lg " + (has ? "" : "grayscale")} aria-hidden>
                  {has ? ach.icon : "🔒"}
                </span>
                <span
                  className={
                    "text-xs font-semibold " + (has ? "text-foreground" : "text-muted")
                  }
                >
                  {ach.title}
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-tight text-muted">{ach.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
});
