import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";

import { MarkdownEditor } from "~/components/markdown-editor";
import {
  ShareCard,
  ShareLoadingState,
  ShareNotFoundState,
  SharePageShell,
  SharePromo,
  ShareTopBar,
} from "~/components/share/share-page";
import { seo } from "~/lib/seo";

/* The public share page for a whirl-authored document — same family as
   /visual/{shortId}: the short token is the only gate, and the backend
   only ever serves completed documents. Rendered read-only through the
   same TipTap editor the in-app panel uses, so it looks identical. */

/** What the public share page reads (no auth; completed documents only). */
type SharedDocument = { title: string; content: string };

const getSharedDocumentRef = makeFunctionReference<"query">(
  "documents:getSharedDocument",
);

export const Route = createFileRoute("/doc/$shortId")({
  component: DocPage,
  head: () =>
    seo({
      title: "Made with Whirl",
      description: "A document written with Whirl.",
    }),
});

function DocPage() {
  const { shortId } = Route.useParams();
  const doc = useQuery(getSharedDocumentRef, { shortId }) as
    | SharedDocument
    | null
    | undefined;

  useEffect(() => {
    if (doc?.title) document.title = `${doc.title} · Whirl`;
  }, [doc?.title]);

  return (
    <SharePageShell>
      {doc === undefined ? (
        <ShareLoadingState />
      ) : doc === null ? (
        <ShareNotFoundState headline="This document isn't available" />
      ) : (
        <SharedDoc doc={doc} />
      )}
    </SharePageShell>
  );
}

function SharedDoc({ doc }: { doc: SharedDocument }) {
  const title = doc.title.trim() || "Document";

  return (
    <>
      <ShareTopBar title={title} />
      <ShareCard>
        <div className="px-1 py-4 sm:px-8 sm:py-8">
          <MarkdownEditor value={doc.content} editable={false} />
        </div>
      </ShareCard>
      <SharePromo line="Write, revise, and share documents just by asking." />
    </>
  );
}
