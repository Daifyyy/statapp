import { NextResponse } from "next/server";
import { getLeagues } from "@/lib/data/repository";

// Seznam lig je prakticky statický → dlouhá CDN cache (§1.1).
export const revalidate = 86400;

export function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind");
  const all = getLeagues();
  const leagues =
    kind === "CLUB_LEAGUE" || kind === "NATIONAL_COMP"
      ? all.filter((l) => l.kind === kind)
      : all;
  return NextResponse.json({ leagues });
}
