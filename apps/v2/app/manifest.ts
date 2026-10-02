import type { MetadataRoute } from "next";

import { DEFAULT_DESCRIPTION, SITE_NAME } from "@/lib/seo";

/* What an install prompt reads, and what the installed app is afterwards:
   its name in the switcher, the chrome it opens without, the colour behind
   the splash, and the two things the OS can hand it (a long-press shortcut,
   a share sheet entry).

   `background_color` paints the splash for the beat before the app's own
   CSS lands, so it has to match what the shell paints — light chrome, since
   that's where a reader with nothing stored starts. `theme_color` is the
   fallback for the status bar; the live one is a meta tag that tracks the
   reader's actual theme (components/pwa/theme-color.tsx). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${SITE_NAME} — AI chat with memory`,
    short_name: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    /* Never force rotation: a phone held sideways and a tablet in a
       keyboard case are both real ways to use a chat app. */
    orientation: "any",
    background_color: "#f3f3f3",
    theme_color: "#ffffff",
    categories: ["productivity", "utilities"],
    lang: "en",
    dir: "ltr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        /* Pulled in far enough to survive any crop Android applies. */
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Integrations", short_name: "Integrations", url: "/integrations" },
      { name: "Settings", short_name: "Settings", url: "/settings" },
    ],
    /* Whirl in the OS share sheet. The text lands in the home composer
       rather than sending on arrival — sharing something is the start of a
       question, not the whole of one (lib/share-target.ts). */
    share_target: {
      action: "/",
      method: "get",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
