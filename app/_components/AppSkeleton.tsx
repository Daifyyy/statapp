// Sdílený skeleton pro route-level loading.tsx → okamžitá zpětná vazba po kliknutí
// na záložku (server stránky blokují render na getCurrentUser → DB). Čistě statické
// markup (žádný "use client"), aby šlo prefetchnout a zobrazit ihned.

export function AppSkeleton() {
  return (
    <div className="flex-1">
      <main className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-8">
        {/* hlavička (logo + akce) */}
        <div className="flex items-center justify-between gap-2">
          <div className="h-10 w-10 animate-pulse rounded-xl bg-border/60" />
          <div className="flex gap-2">
            <div className="h-8 w-20 animate-pulse rounded-full bg-border/60" />
            <div className="h-8 w-9 animate-pulse rounded-full bg-border/60" />
            <div className="h-8 w-9 animate-pulse rounded-full bg-border/60" />
          </div>
        </div>

        {/* nadpis + řádky obsahu */}
        <div className="mt-5 h-6 w-44 animate-pulse rounded bg-border/60" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-border/50" />
        <div className="mt-4 flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-7 w-20 animate-pulse rounded-full bg-border/60" />
          ))}
        </div>
        <div className="mt-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-xl bg-border/60"
              style={{ animationDelay: `${i * 60}ms` }}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
