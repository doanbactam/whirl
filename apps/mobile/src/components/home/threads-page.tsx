import { useCallback, useMemo, useState, type ComponentType } from "react";
import { SectionList, StyleSheet, Text, View } from "react-native";
import { IconLockFilled, IconMessageFilled } from "@tabler/icons-react-native";
import { useConvexAuth } from "convex/react";
import Animated, { FadeIn } from "react-native-reanimated";

import { ThreadRow } from "@/components/home/thread-row";
import { ThreadsSkeleton } from "@/components/home/threads-skeleton";
import { PromptSheet } from "@/components/ui/prompt-sheet";
import { run } from "@/lib/convex-error";
import { duration } from "@/lib/motion";
import type { ThreadId } from "@/lib/convex";
import { useThreadMenu } from "@/lib/thread-menu";
import {
  sectionThreads,
  useThreadActions,
  useThreads,
  type ThreadSummary,
} from "@/lib/threads";
import { spacing, typography, useTheme } from "@/lib/theme";

type ThreadsPageProps = {
  /** The thread the pager's second page is showing, so the list can mark it. */
  activeThreadId: ThreadId | null;
  onOpenThread: (thread: ThreadSummary) => void;
  /** Called when the open thread is deleted from under the pager. */
  onThreadDeleted: (threadId: ThreadId) => void;
};

/**
 * Every conversation you've had, newest first.
 *
 * The query is live — Convex pushes a new list whenever a title lands or a
 * turn finishes — so nothing here polls or refreshes. Pull-to-refresh would be
 * a button that does nothing.
 */
export function ThreadsPage({
  activeThreadId,
  onOpenThread,
  onThreadDeleted,
}: ThreadsPageProps) {
  const { colors } = useTheme();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const threads = useThreads();
  const actions = useThreadActions();

  /* The rename sheet lives here rather than in the row: a row is unmounted the
     moment the list re-orders around it, which is exactly what renaming does. */
  const [renaming, setRenaming] = useState<ThreadSummary | null>(null);

  const sections = useMemo(
    () => (threads ? sectionThreads(threads) : []),
    [threads],
  );

  const handleRename = useCallback(
    (thread: ThreadSummary) => setRenaming(thread),
    [],
  );

  const handleDeleted = useCallback(
    (thread: ThreadSummary) => onThreadDeleted(thread.id),
    [onThreadDeleted],
  );

  /* Convex authenticates a moment behind Clerk, so "no token yet" is normal
     and reads as loading. A token that never arrives is not, and a skeleton
     that shimmers forever tells the user nothing. */
  if (!isLoading && !isAuthenticated) {
    return (
      <PageMessage
        icon={IconLockFilled}
        title="Signed out"
        detail="We couldn't confirm your session. Sign out and back in to see your threads."
      />
    );
  }

  if (threads === undefined) return <ThreadsSkeleton />;

  if (threads.length === 0) {
    return (
      <PageMessage
        icon={IconMessageFilled}
        title="No threads yet"
        detail="Ask something and it'll show up here."
      />
    );
  }

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={(thread) => thread.id}
        renderItem={({ item }) => (
          <ThreadRowItem
            thread={item}
            active={item.id === activeThreadId}
            onOpen={onOpenThread}
            onRename={handleRename}
            onDeleted={handleDeleted}
          />
        )}
        renderSectionHeader={({ section }) => (
          <View style={styles.header}>
            <Text
              style={[typography.label, { color: colors.foregroundMuted }]}
            >
              {section.title}
            </Text>
          </View>
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        /* Every row carries a long-press menu, which on iOS is a SwiftUI host
           of its own — worth not building until the row is near the screen. */
        initialNumToRender={14}
        windowSize={9}
        removeClippedSubviews
      />

      <PromptSheet
        visible={renaming !== null}
        title="Rename thread"
        placeholder="Thread title"
        initialValue={renaming?.title ?? ""}
        onSubmit={(title) => {
          if (!renaming) return;
          run("Couldn't rename thread", actions.rename(renaming.id, title));
        }}
        onDismiss={() => setRenaming(null)}
      />
    </>
  );
}

/** The page with one thing to say on it, centred. */
function PageMessage({
  icon: Icon,
  title,
  detail,
}: {
  icon: ComponentType<{ size: number; color: string }>;
  title: string;
  detail: string;
}) {
  const { colors } = useTheme();

  return (
    <Animated.View
      entering={FadeIn.duration(duration.base)}
      style={styles.message}
    >
      <Icon size={26} color={colors.foregroundMuted} />
      <Text
        style={[
          typography.subtitle,
          styles.centred,
          { color: colors.foregroundSoft },
        ]}
      >
        {title}
      </Text>
      <Text
        style={[
          typography.caption,
          styles.centred,
          { color: colors.foregroundMuted },
        ]}
      >
        {detail}
      </Text>
    </Animated.View>
  );
}

/**
 * A row plus its menu. Split out so the menu — which is a hook, and so can't
 * live inside a `renderItem` callback — has a component to hang off.
 */
function ThreadRowItem({
  thread,
  active,
  onOpen,
  onRename,
  onDeleted,
}: {
  thread: ThreadSummary;
  active: boolean;
  onOpen: (thread: ThreadSummary) => void;
  onRename: (thread: ThreadSummary) => void;
  onDeleted: (thread: ThreadSummary) => void;
}) {
  const actions = useThreadMenu(thread, {
    onRename,
    onDeleted,
  });

  return (
    <ThreadRow
      thread={thread}
      active={active}
      actions={actions}
      onPress={() => onOpen(thread)}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingBottom: spacing.xxl,
  },
  header: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.xl,
  },
  message: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  centred: {
    textAlign: "center",
  },
});
