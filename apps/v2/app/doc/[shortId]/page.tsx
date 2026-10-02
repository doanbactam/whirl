import type { Metadata } from "next";

import { SharedDocument } from "@/components/share/shared-document";
import { publicPageMetadata } from "@/lib/seo";

/* The public page for a shared document — same family as /visual: no
   shell, no auth, the short token is the only gate, and the client
   component reads the public getSharedDocument query directly. */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shortId: string }>;
}): Promise<Metadata> {
  const { shortId } = await params;
  return publicPageMetadata({
    title: "Made with Whirl",
    description: "A document written with Whirl.",
    path: `/doc/${shortId}`,
  });
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ shortId: string }>;
}) {
  const { shortId } = await params;
  return <SharedDocument shortId={shortId} />;
}
