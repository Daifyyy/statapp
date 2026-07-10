import { track } from "@vercel/analytics";

export type ShareOutcome = "shared" | "cancelled" | "copied" | "error";

/**
 * Nativní share sheet (mobil, secure kontext) s fallbackem na schránku. Sdíleno
 * mezi `AppHeader`'s `ShareButton` (sdílí aktuální URL stránky) a herními výsledky
 * v Manažerovi (sdílí vlastní sestavenou URL/titulek, ne `window.location.href`).
 */
export async function shareOrCopy(url: string, title: string): Promise<ShareOutcome> {
  track("share");
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "error";
  }
}
