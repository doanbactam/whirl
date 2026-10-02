"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MedianSupport } from "@mediansh/widget";

import { setSupportOpen } from "@/lib/support";

/* The widget's stylesheet, imported here rather than beside globals.css so it
   code-splits with this chunk. Since 0.2.1 every selector it ships is bounded
   to [data-median-widget], so it stays inside the panel on its own. Only its
   @keyframes names are global, and as of 0.9.0 the shared ones (enter, spin,
   ping) match tw-animate's and Tailwind's. The panel reads the app's shadcn
   tokens, so it follows the theme, the accent and the canvas tint without
   being told. */
import "@mediansh/widget/styles.css";

/* The shell's faces are real routes whose pages render null, so they move
   through the History API the way lib/view.tsx does. A router push would fetch
   a payload for a page with nothing in it. Everything else is a real page and
   needs the router. */
const SHELL_PATH = /^\/(?:$|settings(?:\/|$)|integrations$|thread\/)/;

export function SupportPanel({ open }: { open: boolean }) {
  const router = useRouter();
  const pathname = usePathname();

  const navigate = useCallback(
    (path: string) => {
      if (SHELL_PATH.test(path)) {
        window.history.pushState(null, "", path);
        return;
      }
      router.push(path);
    },
    [router],
  );

  return (
    <MedianSupport
      /* One route answers with the signed Clerk id and the publishable key
         together, so no median_pk_ value is plumbed through the client and
         nothing here has to wait on Clerk to know who is here. */
      identity="/api/median/identity"
      open={open}
      onOpenChange={setSupportOpen}
      launcher="hidden"
      onNavigate={navigate}
      /* Read only when a message is sent, so a panel opened and closed in
         silence records nothing. */
      appState={{
        route: pathname,
        version: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
      }}
      /* A bug report arrives with the failure already attached instead of
         after four messages of asking. console.error stays off: replies stream
         through this app, and what lands in its logs is the customer's, not
         ours to collect. */
      diagnostics={{ errors: true, network: true }}
    />
  );
}
