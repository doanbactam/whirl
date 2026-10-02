import type { MetadataRoute } from "next";

import { kirkifyEnabled } from "@/lib/kirkify/enabled";
import { SITE_URL } from "@/lib/seo";

const pages = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.9 },
  { path: "/platinum", changeFrequency: "monthly", priority: 0.7 },
  { path: "/about", changeFrequency: "monthly", priority: 0.9 },
  { path: "/about/features", changeFrequency: "monthly", priority: 0.8 },
  { path: "/about/developers", changeFrequency: "monthly", priority: 0.7 },
  { path: "/about/pricing", changeFrequency: "monthly", priority: 0.7 },
  { path: "/about/about", changeFrequency: "yearly", priority: 0.6 },
  { path: "/integrations", changeFrequency: "weekly", priority: 0.7 },
  { path: "/kirkify", changeFrequency: "weekly", priority: 0.6 },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const kirkify = kirkifyEnabled();
  return pages
    .filter(({ path }) => kirkify || path !== "/kirkify")
    .map(({ path, changeFrequency, priority }) => ({
      url: new URL(path, SITE_URL).toString(),
      changeFrequency,
      priority,
    }));
}
