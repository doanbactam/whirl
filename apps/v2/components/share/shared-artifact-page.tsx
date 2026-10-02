"use client";

import { useEffect, useState } from "react";
import {
  IconCircleCheckFilled,
  IconLink,
  IconLoader2,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { WhirlLogo } from "@/components/whirl-logo";

/* The shared chrome for a public artifact page (/visual/{shortId} and
   /doc/{shortId}) — the same frame as the shared-conversation page: the
   whole viewport as a raised surface card on the background, a slim
   logo-led header, and centered loading / not-available faces. The short
   token is the only gate; these pages never touch auth. */

const COPY_FLASH_MS = 1600;

export function SharedArtifactPage({
  title,
  loading,
  notFoundHeadline,
  headerActions,
  children,
}: {
  /** The artifact's title once loaded — also becomes the tab title. */
  title: string | null;
  /** True while the query is still in flight. */
  loading: boolean;
  /** Shown when the token doesn't resolve (revoked, mistyped, deleted). */
  notFoundHeadline: string;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (title) document.title = `${title} · Whirl`;
  }, [title]);

  return (
    <div className="flex h-dvh w-full flex-col bg-background p-2">
      <main className="raised relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <IconLoader2
              size={20}
              className="animate-spin text-muted-foreground"
            />
          </div>
        ) : title === null ? (
          <NotAvailable headline={notFoundHeadline} />
        ) : (
          <>
            <SharedArtifactHeader title={title} actions={headerActions} />
            <div className="min-h-0 flex-1">{children}</div>
          </>
        )}
      </main>
    </div>
  );
}

function SharedArtifactHeader({
  title,
  actions,
}: {
  title: string;
  actions?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

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
        <span className="text-[14px]/4 font-semibold max-sm:hidden">Whirl</span>
      </a>
      <span className="h-4 w-px shrink-0 bg-border" />
      <span className="min-w-0 flex-1 truncate text-[13.5px]/4 font-medium">
        {title}
      </span>
      <span className="shrink-0 text-[12px]/4 font-medium text-muted-foreground max-md:hidden">
        Made with Whirl
      </span>
      {actions}
      <Button variant="ghost" size="sm" onClick={copyLink}>
        {copied ? (
          <IconCircleCheckFilled size={14} className="text-emerald-500" />
        ) : (
          <IconLink size={14} stroke={2} />
        )}
        {copied ? "Copied" : "Copy link"}
      </Button>
      <Button size="sm" nativeButton={false} render={<a href="/" />}>
        Make your own
      </Button>
    </header>
  );
}

function NotAvailable({ headline }: { headline: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <WhirlLogo size={32} />
      <div>
        <div className="text-[15px]/5 font-medium">{headline}</div>
        <div className="mt-1 text-[13px]/5 text-muted-foreground">
          The link may be wrong, or its owner may have deleted it.
        </div>
      </div>
      <Button nativeButton={false} render={<a href="/" />}>
        Make your own with Whirl
      </Button>
    </div>
  );
}
