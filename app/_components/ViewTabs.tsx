"use client";

/**
 * Přepínač dvou (či více) pohledů nad **týmiž už načtenými daty** – segmentované
 * tlačítko přes celou šířku. Sdílí ho Zápasy (Program / Výsledky) i Predikce
 * (Tipy / Jak si model vede).
 *
 * **Přepnutí nesmí nic dotahovat.** Je to jen filtr nad tím, co komponenta už má;
 * kdyby si každý pohled tahal vlastní data, patří sem místo přepínače routa.
 */
export function ViewTabs<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: { value: T; label: string }[];
  active: T;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="mt-4 inline-flex w-full rounded-full border border-border bg-surface p-0.5">
      {tabs.map((t) => {
        const activeTab = t.value === active;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onSelect(t.value)}
            aria-pressed={activeTab}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition ${
              activeTab
                ? "bg-foreground text-background"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
