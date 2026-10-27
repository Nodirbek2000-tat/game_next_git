import type { MetadataRoute } from "next";
import { GAMES } from "@/lib/games";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/oyinlar", "/bogcha", "/reyting", "/sozlamalar", "/profil", "/kirish"];
  return [
    ...pages.map((p) => ({ url: `${SITE_URL}${p}`, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.7 })),
    ...GAMES.filter((g) => !g.hidden).map((g) => ({ url: `${SITE_URL}/oyin/${g.slug}`, changeFrequency: "monthly" as const, priority: 0.8 })),
  ];
}
