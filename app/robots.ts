import type { MetadataRoute } from "next";

const BASE = process.env.AUTH_URL ?? "https://statapp-uvol.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // API a auth callbacky nemá smysl crawlovat (žádný obsah, jen šum/kvóta).
      disallow: ["/api/"],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
