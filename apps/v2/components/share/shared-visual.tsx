"use client";

import { useQuery } from "convex/react";
import { IconPlugConnected } from "@tabler/icons-react";
import { api } from "@whirl/backend/convex/_generated/api";

import { Button } from "@/components/ui/button";
import { WhirlLogo } from "@/components/whirl-logo";
import { HtmlFrameView } from "@/components/thread/artifacts/html-frame-view";
import { ReactFrameView } from "@/components/thread/artifacts/react-frame-view";
import { SharedArtifactPage } from "./shared-artifact-page";

/* The public face of a shared artifact (/visual/{shortId}): it fills the card
   in the panel's fill mode — a real stage for games and 3D scenes, internal
   scrolling for long pages. The backend only ever serves completed artifacts.

   An artifact that reads live integration data is never served here at all.
   Its whole content is somebody's private data seen through their own
   connections, and those connections don't exist for a visitor — so the
   backend answers `dataLocked` and this page says so plainly instead of
   rendering an empty shell or a 404 that looks like a broken link. */

type SharedArtifact =
  | { dataLocked: true }
  | {
      dataLocked?: undefined;
      kind: "inline" | "full";
      runtime: "html" | "react";
      title: string;
      content: string;
    };

export function SharedVisual({ shortId }: { shortId: string }) {
  const artifact = useQuery(api.html.getSharedArtifact, { shortId }) as
    | SharedArtifact
    | null
    | undefined;

  if (artifact?.dataLocked) return <DataLocked />;

  const title =
    artifact === null || artifact === undefined
      ? null
      : artifact.title.trim() || "Visualization";

  return (
    <SharedArtifactPage
      title={title}
      loading={artifact === undefined}
      notFoundHeadline="This visualization isn't available"
    >
      {artifact && !artifact.dataLocked ? (
        artifact.runtime === "react" ? (
          /* No htmlId: a visitor has nothing to run bindings against, and an
             artifact with bindings never reaches this page anyway. */
          <ReactFrameView code={artifact.content} title={title ?? undefined} fill />
        ) : (
          <HtmlFrameView
            html={artifact.content}
            title={title ?? undefined}
            fill
          />
        )
      ) : null}
    </SharedArtifactPage>
  );
}

/* Its own face rather than the generic not-found one: nothing is broken here,
   and the reason is worth stating. */
function DataLocked() {
  return (
    <div className="flex h-dvh w-full flex-col bg-background p-2">
      <main className="raised relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-hidden rounded-lg border border-border bg-surface px-6 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl bg-black/[0.04] text-muted-foreground dark:bg-white/[0.06]">
          <IconPlugConnected size={20} stroke={2} />
        </span>
        <div>
          <div className="text-[15px]/5 font-medium">
            This one can&apos;t be shared
          </div>
          <div className="mx-auto mt-1 max-w-sm text-[13px]/5 text-muted-foreground">
            It reads live data from its owner&apos;s connected apps, so it only
            works for them. Nothing to see here, by design.
          </div>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <WhirlLogo size={16} />
          <Button nativeButton={false} render={<a href="/" />}>
            Make your own with Whirl
          </Button>
        </div>
      </main>
    </div>
  );
}
