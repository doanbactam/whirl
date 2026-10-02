import { useState } from "react";
import { IconCircleCheckFilled, IconEye, IconLink } from "@tabler/icons-react";

import { COMPOSER_GLASS_CONTROL } from "~/components/composer";
import { showToast } from "~/data/toasts";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

// Floating frosted-glass chips in the top-right corner, matching the live
// thread's toolbar — a read-only marker and a copy-link button.
const chipClass = `flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium ${COMPOSER_GLASS_CONTROL}`;

/**
 * The shared thread's top-right toolbar: a quiet "Read-only" badge so the viewer
 * knows the conversation can't be edited, and a button to copy the share link.
 * Pinned to the top-right corner of the chat surface like the live thread's
 * toolbar (the chat scrolls through behind the translucent chips).
 */
export function ShareTopBar() {
  const [copied, setCopied] = useState(false);
  const capture = useCapture();

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      capture(ANALYTICS_EVENTS.sharedThreadLinkCopied);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      showToast({ tone: "success", message: "Link copied to clipboard." });
    } catch {
      // Clipboard may be blocked (insecure context); ignore.
    }
  };

  const LinkGlyph = copied ? IconCircleCheckFilled : IconLink;

  return (
    <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5">
      <span
        className={`${chipClass} cursor-default text-neutral-500 dark:text-neutral-400`}
        title="You're viewing a shared, read-only conversation"
      >
        <IconEye size={15} stroke={2} />
        <span className="max-sm:hidden">Read-only</span>
      </span>
      <button
        type="button"
        onClick={copyLink}
        title="Copy link to this conversation"
        className={`${chipClass} text-neutral-700 dark:text-neutral-200`}
      >
        <LinkGlyph
          size={15}
          stroke={2}
          className={copied ? "text-emerald-500" : ""}
        />
        <span className="max-sm:hidden">{copied ? "Copied" : "Copy link"}</span>
      </button>
    </div>
  );
}
