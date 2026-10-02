import type { Metadata } from "next";

/* The thread face is rendered by the shell layout (always mounted, so the
   composer glides between home and thread); this route just claims
   /thread/<id>. The real title lands client-side once the thread list
   answers — the server only knows the id. */

export const metadata: Metadata = { title: "Whirl" };

export default function ThreadPage() {
  return null;
}
