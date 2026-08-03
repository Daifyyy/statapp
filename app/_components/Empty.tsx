/**
 * Prázdný / chybový stav — čárkovaný rámeček přes celou šířku sekce.
 *
 * Býval nakopírovaný v šesti souborech (Zápasy, Predikce, Digest, Přestupy, Tipovačka,
 * Porovnání) v pěti bajtově shodných kopiích a jedné, která se lišila jen horním okrajem.
 * `className` je tu **jen kvůli tomu okraji** – na odsazení má každá stránka jiný rytmus.
 * Vzhled rámečku se nepřepisuje, jinak by se šest kopií vrátilo zadními vrátky.
 */
export function Empty({
  children,
  className = "mt-4",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`${className} rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center text-sm text-muted`}
    >
      {children}
    </div>
  );
}
