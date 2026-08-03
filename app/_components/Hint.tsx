"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Vysvětlivka, která jde **otevřít tapnutím**.
 *
 * `title=""` je na dotykovém displeji nedostupný – a appka běží primárně jako PWA na
 * telefonu. Přitom právě tam nesl `title` jediný zdroj významu: hlavičky ligové tabulky
 * (`Z`, `V`, `R`, `P`, `+/-`, `B`) a ⓘ u metrik v Porovnání. Text tedy nešel přečíst
 * zrovna tam, kde se čte nejčastěji.
 *
 * Bublina se pozicuje absolutně vůči tlačítku a **zarovnává se podle strany**, aby na
 * úzkém displeji nepřetekla ven (`align="end"` u sloupců vpravo).
 */
export function Hint({
  label,
  children,
  align = "center",
}: {
  /** Popisek pro odečítač – co se vysvětluje (např. „Body"). */
  label: string;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Klik jinam / Esc zavírá. Bez toho zůstane bublina viset přes obsah.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pos =
    align === "end"
      ? "right-0"
      : align === "start"
        ? "left-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${label} – vysvětlení`}
        className="cursor-help align-middle text-muted/70 transition hover:text-foreground"
      >
        ⓘ
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute top-full z-20 mt-1 block w-max max-w-[min(16rem,70vw)] rounded-lg border border-border bg-surface px-2.5 py-1.5 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-foreground shadow-lg ${pos}`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
