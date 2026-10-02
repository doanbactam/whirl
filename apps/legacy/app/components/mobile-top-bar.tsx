import { useState } from "react";
import { useUser } from "@clerk/tanstack-react-start";
import { IconLogin2, IconMessageCircle } from "@tabler/icons-react";

import { FeedbackModal } from "~/components/feedback-modal";
import { useAuthGate } from "~/lib/auth-gate";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

const iconButtonClass =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-black/[0.06] active:bg-black/[0.08] dark:text-neutral-400 dark:hover:bg-white/[0.08] dark:active:bg-white/[0.12]";

const pillButtonClass =
  "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-neutral-700 transition-colors hover:bg-black/[0.06] active:bg-black/[0.08] dark:text-neutral-200 dark:hover:bg-white/[0.08]";

/** Sign in + feedback shortcuts for mobile — desktop has these in the sidebar. */
export function MobileTopBar() {
  const { user, isLoaded } = useUser();
  const { requireAuth } = useAuthGate();
  const capture = useCapture();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const openFeedback = () => {
    if (!user) {
      requireAuth();
      return;
    }
    capture(ANALYTICS_EVENTS.feedbackOpened);
    setFeedbackOpen(true);
  };

  return (
    <>
      <div className="flex shrink-0 items-center justify-end gap-1.5 px-3 pb-1.5 pt-[max(0.625rem,env(safe-area-inset-top))] md:hidden">
        {!isLoaded ? (
          <div
            aria-hidden
            className="h-8 w-[5.25rem] animate-pulse rounded-full bg-black/[0.06] dark:bg-white/[0.08]"
          />
        ) : !user ? (
          <button
            type="button"
            onClick={() => requireAuth()}
            className={pillButtonClass}
          >
            <IconLogin2 size={15} stroke={2} />
            Sign in
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Send feedback"
          onClick={openFeedback}
          className={iconButtonClass}
        >
          <IconMessageCircle size={18} stroke={2} />
        </button>
      </div>
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />
    </>
  );
}
