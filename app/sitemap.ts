import type { MetadataRoute } from "next";

// Hlavní záložky pro indexaci. Porovnání s konkrétními týmy se neindexují plošně
// (kombinatorika + kanonická URL řeší dedup), sitemap drží jen stabilní vstupy.
const BASE = process.env.AUTH_URL ?? "https://statapp-uvol.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes: { path: string; priority: number; changeFrequency: "daily" | "weekly" }[] = [
    { path: "/", priority: 1, changeFrequency: "daily" },
    { path: "/predikce", priority: 0.8, changeFrequency: "daily" },
    { path: "/transfers", priority: 0.6, changeFrequency: "weekly" },
  ];
  return routes.map((r) => ({
    url: `${BASE}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
