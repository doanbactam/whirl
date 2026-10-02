import { useMemo } from "react";
import { Alert, Platform, Share } from "react-native";
import {
  IconLinkOff,
  IconPencil,
  IconPinFilled,
  IconPinnedOff,
  IconShare3,
  IconSparklesFilled,
  IconTrashFilled,
} from "@tabler/icons-react-native";

import { run } from "@/lib/convex-error";
import type { MenuAction } from "@/lib/menu";
import { useThreadActions, type ThreadSummary } from "@/lib/threads";

type MenuHandlers = {
  /** Opens the rename sheet — the page owns it, since a row can't host one. */
  onRename: (thread: ThreadSummary) => void;
  /** Fired once a delete is confirmed, so the page can let go of the thread. */
  onDeleted: (thread: ThreadSummary) => void;
};

/**
 * Everything you can do to a thread without opening it, in the order the web
 * app's ⋯ menu offers them: the reversible things first, sharing next, and the
 * one that can't be taken back last and in red.
 */
export function useThreadMenu(
  thread: ThreadSummary,
  { onRename, onDeleted }: MenuHandlers,
): MenuAction[] {
  const actions = useThreadActions();

  return useMemo(() => {
    const pinned = thread.pinnedAt !== null;
    const generating = thread.titleStatus === "generating";

    const items: MenuAction[] = [
      {
        key: "pin",
        label: pinned ? "Unpin" : "Pin",
        systemImage: pinned ? "pin.slash.fill" : "pin.fill",
        icon: pinned ? IconPinnedOff : IconPinFilled,
        onPress: () =>
          run(
            pinned ? "Couldn't unpin thread" : "Couldn't pin thread",
            actions.setPinned(thread.id, !pinned),
          ),
      },
      {
        key: "rename",
        label: "Rename",
        systemImage: "pencil",
        icon: IconPencil,
        onPress: () => onRename(thread),
      },
      {
        key: "regenerate",
        label: "Regenerate title",
        systemImage: "sparkles",
        icon: IconSparklesFilled,
        // Already thinking of a name — asking again would only restart it.
        disabled: generating,
        onPress: () =>
          run("Couldn't regenerate title", actions.regenerateTitle(thread.id)),
      },
      {
        key: "share",
        label: thread.shareId ? "Share link" : "Share",
        systemImage: "square.and.arrow.up",
        icon: IconShare3,
        onPress: () =>
          run(
            "Couldn't share thread",
            /* Minting the link and handing it to the system sheet are one
               action to the user, so they're one promise here — a failure in
               either half says the same thing. */
            actions.share(thread.id).then((url) =>
              Share.share(
                Platform.OS === "ios"
                  ? { url, message: thread.title }
                  : { message: url },
                { dialogTitle: "Share thread" },
              ),
            ),
          ),
      },
    ];

    /* Only worth offering once there's a link to revoke. */
    if (thread.shareId) {
      items.push({
        key: "unshare",
        label: "Stop sharing",
        systemImage: "xmark.circle",
        icon: IconLinkOff,
        onPress: () =>
          run("Couldn't stop sharing", actions.unshare(thread.id)),
      });
    }

    items.push({
      key: "delete",
      label: "Delete",
      systemImage: "trash",
      icon: IconTrashFilled,
      destructive: true,
      onPress: () => confirmDelete(thread, () => {
        onDeleted(thread);
        run("Couldn't delete thread", actions.remove(thread.id));
      }),
    });

    return items;
  }, [thread, actions, onRename, onDeleted]);
}

/**
 * There's no undo on the phone — the web app's toast has a five-second window
 * and nowhere here holds one — so the confirmation happens before the delete
 * rather than after it.
 */
function confirmDelete(thread: ThreadSummary, commit: () => void) {
  Alert.alert(
    "Delete thread?",
    `"${thread.title}" and everything in it will be gone for good.`,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: commit },
    ],
  );
}
