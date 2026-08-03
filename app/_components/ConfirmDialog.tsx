"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Potvrzení destruktivní akce — náhrada za nativní `confirm()`.
 *
 * Vzniklo v Manažerovi (smazání kariéry) a bylo tam zavřené, takže mazání tipu
 * i uloženého porovnání zůstalo na jeden klik bez undo. Tady je to sdílené, aby
 * „nevratná akce se ptá" platilo napříč appkou, ne jen v jedné sekci.
 */
export interface ConfirmDialogData {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

/**
 * Stav dialogu + otevírák. Volající drží jen `ask({...})`, samotný modal vykreslí
 * `<ConfirmDialog {...confirm} />` na konci svého stromu.
 */
export function useConfirm(): {
  data: ConfirmDialogData | null;
  ask: (d: ConfirmDialogData) => void;
  close: () => void;
} {
  const [data, setData] = useState<ConfirmDialogData | null>(null);
  const close = useCallback(() => setData(null), []);
  return { data, ask: setData, close };
}

export function ConfirmDialog({
  data,
  onClose,
}: {
  data: ConfirmDialogData | null;
  onClose: () => void;
}) {
  // Esc zavírá. Bez toho je modal na klávesnici past – potvrzení jde odkliknout jen myší.
  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [data, onClose]);

  if (!data) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Potvrzení akce"
      // Na mobilu u spodního okraje (palec), od `sm` na střed.
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-foreground">{data.message}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-border/40"
          >
            Zrušit
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => {
              data.onConfirm();
              onClose();
            }}
            className="flex-1 rounded-full bg-negative px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            {data.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
