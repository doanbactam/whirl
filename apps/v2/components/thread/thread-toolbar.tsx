"use client";

import { ThreadFilesMenu } from "./thread-files-menu";
import { ThreadShare } from "./thread-share";

/* The floating cluster in a thread's top-right corner: the files menu
   (documents, visualizations, attachments) and the share control. It
   floats over the transcript the way the composer dock does — translucent
   pills, no chrome bar behind them. Mounted by chat-view.tsx only while a
   thread is open and the viewer is signed in.

   A locked thread has neither pill and the corner stays empty: it can hold
   no artifacts (nothing may write them in the clear) and can't be shared at
   all, since a viewer would have no key. */

export function ThreadToolbar({
  threadId,
  locked = false,
}: {
  threadId: string;
  locked?: boolean;
}) {
  if (locked) return null;
  return (
    <div className="flex items-center gap-1.5">
      <ThreadFilesMenu threadId={threadId} />
      <ThreadShare key={threadId} threadId={threadId} />
    </div>
  );
}
