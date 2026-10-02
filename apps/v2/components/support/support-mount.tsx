"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";

import { TOOLBAR_PILL_CLASS } from "@/components/thread/toolbar-pill";
import { Spinner } from "@/components/ui/spinner";
import { setSupportAvailable, useSupportState } from "@/lib/support";

/* Mounted on demand rather than with the page. The widget defers its own heavy
   half now, so the docs are right that a lazy wrapper buys a host nothing: the
   launcher is what waits, and it should not.

   We hide the launcher, so there is no button to delay. What is left to defer
   is ~93KB of JavaScript, ~12KB of CSS and a second Convex socket, opened for
   the life of every tab whether or not anyone asks a question. Whirl tabs stay
   open for hours, so that socket is the reason this gate is still here. */
const importPanel = () => import("./support-panel");

const SupportPanel = dynamic(
  () => importPanel().then((module) => module.SupportPanel),
  { ssr: false, loading: SupportLoading },
);

/* Between the click and the panel there is a chunk to fetch, so the corner says
   something is coming instead of leaving the click looking dropped. Same
   floating capsule as the thread toolbar's pills, where the panel is about to
   open. */
function SupportLoading() {
  return (
    <div
      role="status"
      className={`${TOOLBAR_PILL_CLASS} fixed right-4 bottom-4 z-50 cursor-default`}
    >
      <Spinner />
      Opening support
    </div>
  );
}

/** Mounted once by the root layout. Renders nothing until support is asked
 *  for, and nothing at all on a deployment without a support agent. */
export function SupportMount({ enabled }: { enabled: boolean }) {
  const { mounted, open } = useSupportState();

  useEffect(() => {
    setSupportAvailable(enabled);
  }, [enabled]);

  useEffect(() => {
    if (enabled && mounted) void importPanel();
  }, [enabled, mounted]);

  if (!enabled || !mounted) return null;
  return <SupportPanel open={open} />;
}
