"use client";

import { useEffect, useState } from "react";
import type { SessionUser } from "./sessionUser";

/**
 * Klientské načtení přihlášeného uživatele přes `/api/me`. Umožňuje, aby stránka byla
 * **statická** (nemusí číst session při SSR → servíruje se z CDN); user se dohydratuje
 * po mountu (anon = null). Cena: krátký flash „nepřihlášen" v hlavičce. Sdílené mezi
 * statickými záložkami (Zápasy, Tabulky…).
 */
export function useCurrentUser(): SessionUser | null {
  const [user, setUser] = useState<SessionUser | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/me")
      .then((r) => r.json())
      .then((d: { user?: SessionUser | null }) => {
        if (active) setUser(d.user ?? null);
      })
      .catch(() => {
        // bez usera běží stránka jako anonym (FREE)
      });
    return () => {
      active = false;
    };
  }, []);
  return user;
}
