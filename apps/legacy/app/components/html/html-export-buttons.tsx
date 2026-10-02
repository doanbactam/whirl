import { useState } from "react";
import {
  IconArrowUpRight,
  IconCircleCheckFilled,
  IconDownload,
  IconLink,
} from "@tabler/icons-react";

import {
  downloadHtmlArtifact,
  openHtmlArtifactInNewTab,
} from "~/lib/html-export";
import { visualUrl } from "~/lib/share";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

/**
 * The HTML panel's export controls: copy the shareable {site}/visual/{id} link,
 * open the page in a new tab, or download it as a self-contained .html file
 * (both carry the "Made with Whirl" chrome, see lib/html-frame).
 */
export function HtmlExportButtons({
  title,
  html,
  shortId,
}: {
  title: string;
  html: string;
  shortId?: string;
}) {
  const capture = useCapture();
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    if (!shortId) return;
    try {
      await navigator.clipboard.writeText(visualUrl(shortId));
      capture(ANALYTICS_EVENTS.htmlLinkCopied, { mode: "full" });
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be blocked; ignore.
    }
  };

  return (
    <>
      {shortId ? (
        <button
          type="button"
          aria-label="Copy share link"
          title="Copy share link"
          onClick={copyLink}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
        >
          {copied ? (
            <IconCircleCheckFilled size={15} className="text-emerald-500" />
          ) : (
            <IconLink size={15} stroke={2} />
          )}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Open in a new tab"
        title="Open in new tab"
        onClick={() => {
          capture(ANALYTICS_EVENTS.htmlOpenedInNewTab, { mode: "full" });
          openHtmlArtifactInNewTab(title, html, shortId);
        }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
      >
        <IconArrowUpRight size={15} stroke={2} />
      </button>
      <button
        type="button"
        title="Download HTML"
        onClick={() => {
          capture(ANALYTICS_EVENTS.htmlDownloaded, { mode: "full" });
          downloadHtmlArtifact(title, html, shortId);
        }}
        className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-[#0c82f2] pl-2 pr-2.5 text-white transition-colors hover:bg-[#0a74d8]"
      >
        <IconDownload size={14} stroke={2} />
        <span className="text-[12px] font-medium">Download</span>
      </button>
    </>
  );
}
