import type { Metadata } from "next";

import { SharedThread } from "@/components/share/shared-thread";
import { publicPageMetadata } from "@/lib/seo";

/* The public read-only page for a shared conversation. Lives outside the
   (shell) group on purpose: no sidebar, no composer, no auth — the share
   token is the only gate, and the client component talks straight to the
   public getSharedThread query. The real title lands client-side once the
   payload answers; the server only knows the token. */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  return publicPageMetadata({
    title: "Shared on Whirl",
    description: "A conversation shared from Whirl.",
    path: `/share/${shareId}`,
  });
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  return <SharedThread shareId={shareId} />;
}
