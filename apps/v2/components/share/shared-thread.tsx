"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconCircleCheckFilled,
  IconEyeFilled,
  IconLink,
  IconLoader2,
  IconMarkdown,
} from "@tabler/icons-react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@whirl/backend/convex/_generated/api";

import { Button } from "@/components/ui/button";
import { TranscriptHandoffDialog } from "@/components/share/transcript-handoff-dialog";
import { ArtifactPanel } from "@/components/thread/artifacts/artifact-panel";
import { ThreadView } from "@/components/thread/thread-view";
import { Toaster } from "@/components/toaster";
import { WhirlLogo } from "@/components/whirl-logo";
import { closeArtifactPanel } from "@/lib/artifact-panel";
import {
  FixtureArtifactsProvider,
  type FixtureArtifacts,
} from "@/lib/live-artifacts";
import type { ChatMessage, MessagePhase } from "@/lib/messages";
import type { SharedThreadPayload } from "@/lib/thread-transcript";
import { showToast } from "@/lib/toasts";

/* The public face of a shared conversation: the real thread view, wearing
   its read-only manners. The unauthenticated getSharedThread query hands
   back a trimmed payload (messages plus completed documents and
   visualizations — never reasoning, sources, or attachments); the artifact
   bodies ride in through the fixture provider, so the same cards and side
   panel work without auth and without touching Convex per-artifact.

   It's live: revoking the link drops the page to "not available" in
   place, and new turns appear as the owner keeps chatting. */

const COPY_FLASH_MS = 1600;

export function SharedThread({ shareId }: { shareId: string }) {
  const thread = useQuery(api.threads.getSharedThread, { shareId }) as
    | SharedThreadPayload
    | null
    | undefined;

  /* A stale panel target from an earlier in-app session must not greet
     the share page; and leaving shouldn't drag one back into the app. */
  useEffect(() => {
    closeArtifactPanel();
    return () => closeArtifactPanel();
  }, []);

  useEffect(() => {
    if (thread) document.title = `${thread.title} · Whirl`;
  }, [thread]);

  const view = useMemo(() => {
    if (!thread) return null;
    const fixtures: FixtureArtifacts = {
      documents: Object.fromEntries(
        Object.entries(thread.documents).map(([id, doc]) => [
          id,
          {
            title: doc.title,
            content: doc.content,
            format: doc.format,
            fileName: doc.fileName ?? undefined,
            language: doc.language ?? undefined,
            status: "complete" as const,
          },
        ]),
      ),
      html: Object.fromEntries(
        Object.entries(thread.visualizations).map(([id, visual]) => [
          id,
          {
            kind: visual.kind,
            runtime: visual.runtime,
            title: visual.title,
            content: visual.content,
            status: "complete" as const,
            shortId: visual.shortId ?? undefined,
            dataLocked: visual.dataLocked,
          },
        ]),
      ),
    };
    const messages: ChatMessage[] = thread.messages.map((message) => {
      const phases: MessagePhase[] = message.artifacts.map((artifact) =>
        artifact.kind === "document"
          ? {
              kind: "document",
              documentId: artifact.refId,
              op: artifact.op,
              editCount: artifact.editCount ?? undefined,
              title: thread.documents[artifact.refId]?.title,
              ok: true,
            }
          : {
              kind: "html",
              htmlId: artifact.refId,
              op: artifact.op,
              editCount: artifact.editCount ?? undefined,
              title: thread.visualizations[artifact.refId]?.title,
              mode: thread.visualizations[artifact.refId]?.kind,
              ok: true,
            },
      );
      /* Whirl-painted pictures ride the payload as plain URLs — an image
         phase puts them through the same MorphingImage cards as a live
         thread. (?? guards a payload from a backend that predates the
         field.) */
      const images = message.images ?? [];
      if (images.length > 0) {
        phases.push({ kind: "image", images, ok: true });
      }
      return {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        ...(message.role === "assistant"
          ? { status: "complete" as const }
          : {}),
        ...(phases.length > 0 ? { phases } : {}),
      };
    });
    return { fixtures, messages };
  }, [thread]);

  return (
    <div className="flex h-dvh w-full flex-col bg-background p-2">
      <main className="raised relative flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface">
        {view ? (
          <FixtureArtifactsProvider value={view.fixtures}>
            {/* min-w-0 matters: without it a wide artifact card or code
                block sets the column's intrinsic width and the whole page
                lays out beyond a phone screen, clipped by main's
                overflow-hidden — mirrors chat-view's column. */}
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              <SharedThreadHeader shareId={shareId} title={thread!.title} />
              <div className="min-h-0 flex-1">
                <ThreadView
                  messages={view.messages}
                  defaultScrollPosition="start"
                />
              </div>
            </div>
            <ArtifactPanel />
          </FixtureArtifactsProvider>
        ) : thread === undefined ? (
          <div className="flex flex-1 items-center justify-center">
            <IconLoader2
              size={20}
              className="animate-spin text-muted-foreground"
            />
          </div>
        ) : (
          <NotAvailable />
        )}
      </main>
      <Toaster />
    </div>
  );
}

function SharedThreadHeader({
  shareId,
  title,
}: {
  shareId: string;
  title: string;
}) {
  const [copied, setCopied] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const copyLink = () => {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FLASH_MS);
      })
      .catch(() => {});
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
      <a
        href="/"
        aria-label="Whirl home"
        className="flex shrink-0 items-center gap-2"
      >
        <WhirlLogo size={18} />
        <span className="text-[14px]/4 font-semibold max-sm:hidden">
          Whirl
        </span>
      </a>
      <span className="h-4 w-px shrink-0 bg-border" />
      <span className="min-w-0 flex-1 truncate text-[13.5px]/4 font-medium">
        {title}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-[12px]/4 font-medium text-muted-foreground max-md:hidden">
        <IconEyeFilled size={14} />
        Read-only
      </span>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Transcript"
        onClick={() => setTranscriptOpen(true)}
      >
        <IconMarkdown size={14} stroke={2} />
        <span className="max-md:hidden">Transcript</span>
      </Button>
      <TranscriptHandoffDialog
        shareId={shareId}
        open={transcriptOpen}
        onOpenChange={setTranscriptOpen}
      />
      <Button
        variant="ghost"
        size="sm"
        aria-label={copied ? "Copied" : "Copy link"}
        onClick={copyLink}
      >
        {copied ? (
          <IconCircleCheckFilled size={14} className="text-emerald-500" />
        ) : (
          <IconLink size={14} stroke={2} />
        )}
        <span className="max-md:hidden">{copied ? "Copied" : "Copy link"}</span>
      </Button>
      <ContinueButton shareId={shareId} />
    </header>
  );
}

/* Signed-in visitors fork the conversation into their own account and
   keep talking; everyone else heads home to sign in first. */
function ContinueButton({ shareId }: { shareId: string }) {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const forkThread = useMutation(api.threads.forkSharedThread);
  const [forking, setForking] = useState(false);

  const continueChat = async () => {
    if (!isAuthenticated) {
      router.push("/");
      return;
    }
    setForking(true);
    try {
      const result = await forkThread({ shareId });
      router.push(`/thread/${result.threadId}`);
    } catch {
      showToast("Couldn't copy this conversation. Try again?");
      setForking(false);
    }
  };

  return (
    <Button size="sm" disabled={forking} onClick={continueChat}>
      {forking && <IconLoader2 size={14} className="animate-spin" />}
      <span className="max-sm:hidden">Continue this chat</span>
      <span className="sm:hidden">Continue</span>
    </Button>
  );
}

export function NotAvailable() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <WhirlLogo size={32} />
      <div>
        <div className="text-[15px]/5 font-medium">
          This conversation isn&apos;t available
        </div>
        <div className="mt-1 text-[13px]/5 text-muted-foreground">
          The link may have been turned off by its owner.
        </div>
      </div>
      <Button nativeButton={false} render={<a href="/" />}>
        Start your own chat
      </Button>
    </div>
  );
}
