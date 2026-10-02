import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { HtmlFrameView } from "~/components/html/html-frame-view";
import {
  getSharedArtifactRef,
  type SharedArtifact,
} from "~/components/html/shared";
import {
  ShareCard,
  ShareLoadingState,
  ShareNotFoundState,
  SharePageShell,
  SharePromo,
  ShareTopBar,
} from "~/components/share/share-page";
import { seo } from "~/lib/seo";

export const Route = createFileRoute("/visual/$shortId")({
  component: VisualPage,
  head: () =>
    seo({
      title: "Made with Whirl",
      description: "An interactive visualization made with Whirl.",
    }),
});

// A full page artifact can be tall — let the iframe grow and the page scroll.
const SHARE_MAX_HEIGHT = 100_000;

function VisualPage() {
  const { shortId } = Route.useParams();
  const artifact = useQuery(getSharedArtifactRef, { shortId }) as
    | SharedArtifact
    | null
    | undefined;

  useEffect(() => {
    if (artifact?.title) document.title = `${artifact.title} · Whirl`;
  }, [artifact?.title]);

  return (
    <SharePageShell>
      {artifact === undefined ? (
        <ShareLoadingState />
      ) : artifact === null ? (
        <ShareNotFoundState headline="This visualization isn't available" />
      ) : (
        <Artifact artifact={artifact} />
      )}
    </SharePageShell>
  );
}

function Artifact({ artifact }: { artifact: SharedArtifact }) {
  const title = artifact.title?.trim() || "Visualization";

  return (
    <>
      <ShareTopBar title={title} />
      <ShareCard>
        <HtmlFrameView
          html={artifact.content}
          title={title}
          maxHeight={SHARE_MAX_HEIGHT}
        />
      </ShareCard>
      <SharePromo line="Create your own charts, diagrams, and pages just by asking." />
    </>
  );
}
