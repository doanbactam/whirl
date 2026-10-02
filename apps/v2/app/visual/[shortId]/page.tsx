import type { Metadata } from "next";

import { SharedVisual } from "@/components/share/shared-visual";
import { publicPageMetadata } from "@/lib/seo";

/* The public page for a shared visualization. Lives outside the (shell)
   group on purpose: no sidebar, no composer, no auth — the short token is
   the only gate, and the client component talks straight to the public
   getSharedArtifact query. The real title lands client-side once the
   payload answers; the server only knows the token. */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shortId: string }>;
}): Promise<Metadata> {
  const { shortId } = await params;
  return publicPageMetadata({
    title: "Made with Whirl",
    description: "An interactive visualization made with Whirl.",
    path: `/visual/${shortId}`,
  });
}

export default async function VisualPage({
  params,
}: {
  params: Promise<{ shortId: string }>;
}) {
  const { shortId } = await params;
  return <SharedVisual shortId={shortId} />;
}
