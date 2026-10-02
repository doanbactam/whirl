"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconArrowLeft,
  IconCircleCheckFilled,
  IconCopy,
  IconDownload,
  IconLoader2,
} from "@tabler/icons-react";
import { useQuery } from "convex/react";
import { api } from "@whirl/backend/convex/_generated/api";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/toaster";
import { WhirlLogo } from "@/components/whirl-logo";
import { downloadMarkdown } from "@/lib/document-export";
import {
  buildThreadTranscript,
  type SharedThreadPayload,
} from "@/lib/thread-transcript";
import { NotAvailable } from "./shared-thread";

/* The raw face of a shared conversation: the whole thread serialized to
   one markdown document, ready to select, copy, or download. Same public
   query and read-only manners as the pretty page next door — the token is
   still the only gate. */

const COPY_FLASH_MS = 1600;

export function SharedTranscript({ shareId }: { shareId: string }) {
  const thread = useQuery(api.threads.getSharedThread, { shareId }) as
    | SharedThreadPayload
    | null
    | undefined;
  const [copied, setCopied] = useState(false);

  const markdown = useMemo(
    () => (thread ? buildThreadTranscript(thread) : null),
    [thread],
  );

  useEffect(() => {
    if (thread) document.title = `${thread.title} · Transcript · Whirl`;
  }, [thread]);

  const copyTranscript = () => {
    if (!markdown) return;
    navigator.clipboard
      .writeText(markdown)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FLASH_MS);
      })
      .catch(() => {
        /* Clipboard may be blocked (insecure context); the text is still
           right there to select by hand. */
      });
  };

  return (
    <div className="flex h-dvh w-full flex-col bg-background p-2">
      <main className="raised relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        {thread && markdown !== null ? (
          <>
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
                {thread.title}
              </span>
              <span className="shrink-0 text-[12px]/4 font-medium text-muted-foreground max-md:hidden">
                Markdown transcript
              </span>
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<a href={`/share/${shareId}`} />}
              >
                <IconArrowLeft size={14} stroke={2} />
                <span className="max-md:hidden">Pretty view</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => downloadMarkdown(thread.title, markdown)}
              >
                <IconDownload size={14} stroke={2} />
                <span className="max-md:hidden">Download</span>
              </Button>
              <Button size="sm" onClick={copyTranscript}>
                {copied ? (
                  <IconCircleCheckFilled size={14} />
                ) : (
                  <IconCopy size={14} stroke={2} />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <pre className="mx-auto w-full max-w-3xl px-6 py-6 font-mono text-[12.5px]/5.5 whitespace-pre-wrap break-words text-foreground">
                {markdown}
              </pre>
            </div>
          </>
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
