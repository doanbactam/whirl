import type { Metadata } from "next";

import { SharedTranscript } from "@/components/share/shared-transcript";
import { publicPageMetadata } from "@/lib/seo";

/* The raw markdown transcript of a shared conversation — same public
   token gate as /share/{shareId}, different clothes: one selectable
   markdown document instead of the rendered thread. */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  return publicPageMetadata({
    title: "Transcript · Shared on Whirl",
    description: "The raw markdown transcript of a conversation shared from Whirl.",
    path: `/share/${shareId}/raw`,
  });
}

export default async function SharedTranscriptPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  return <SharedTranscript shareId={shareId} />;
}
