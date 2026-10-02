import { useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useAuth, useUser } from "@clerk/expo";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";

import { AccountSheet } from "@/components/home/account-sheet";
import { GreetingPage } from "@/components/home/greeting-page";
import {
  NewThreadPull,
  PULL_THRESHOLD,
} from "@/components/home/new-thread-pull";
import { ThreadsPage } from "@/components/home/threads-page";
import { TopBar } from "@/components/home/top-bar";
import { Composer } from "@/components/composer/composer";
import { Screen } from "@/components/ui/screen";
import { describeClerkError } from "@/lib/clerk-error";
import type { ThreadId } from "@/lib/convex";
import type { ThreadSummary } from "@/lib/threads";
import { spacing } from "@/lib/theme";

/** Until a thread is named, it's called this — in the strip and everywhere. */
const UNTITLED = "New thread";

/**
 * A tab is not a headline. The strip shares its row with two buttons now, so
 * titles get cut well before they'd crowd them.
 */
const TITLE_LIMIT = 16;

function asTabTitle(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return UNTITLED;
  return trimmed.length > TITLE_LIMIT
    ? `${trimmed.slice(0, TITLE_LIMIT).trimEnd()}…`
    : trimmed;
}

/** The model the next turn goes to. Static until there's a picker. */
const MODEL = "Auto";

const THREADS_PAGE = 0;
const THREAD_PAGE = 1;

export default function HomeScreen() {
  const { signOut } = useAuth();
  const { user } = useUser();
  const { width } = useWindowDimensions();

  const pager = useRef<ScrollView>(null);
  /* Fractional page position, straight off the scroll offset — the tab pill
     rides this so it tracks a drag rather than snapping after it. */
  const progress = useSharedValue(THREAD_PAGE);
  /* Overscroll past the last page, in points. Pull far enough and letting go
     starts a new thread — the gesture shortcut for "+ New" in the strip. */
  const pull = useSharedValue(0);
  const [page, setPage] = useState(THREAD_PAGE);

  const [title, setTitle] = useState(UNTITLED);
  /* Which thread the second page is showing, so the list can mark it and the
     tab can wear its name. Null means "a thread that hasn't started yet". */
  const [threadId, setThreadId] = useState<ThreadId | null>(null);
  const [incognito, setIncognito] = useState(false);
  /* Measured rather than guessed, so the greeting centres in the space the
     composer actually leaves it. */
  const [dockHeight, setDockHeight] = useState(0);

  const [accountOpen, setAccountOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const onThread = page === THREAD_PAGE;

  /* Off the record, the tab says so instead of the thread's name — the state
     matters more than the title while you're in it, and there'll be no title
     to keep afterwards anyway. */
  const tabs = useMemo(
    () => [
      { key: "threads", label: "Threads" },
      { key: "thread", label: incognito ? "Incognito" : title },
    ],
    [incognito, title],
  );

  const goTo = (index: number) => {
    setPage(index);
    pager.current?.scrollTo({ x: index * width, animated: true });
  };

  /* Declared above the scroll handler on purpose. A worklet captures the
     values it names when it's built, so a `const` declared further down the
     component is still in its dead zone at that moment — `runOnJS` would be
     handed nothing and the gesture would take the app out with it. */
  const startNewThread = () => {
    setTitle(UNTITLED);
    setThreadId(null);
    goTo(THREAD_PAGE);
  };

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      progress.value = event.contentOffset.x / width;
      // Only the rubber band past the last page counts as a pull.
      pull.value = Math.max(event.contentOffset.x - THREAD_PAGE * width, 0);
    },
    onEndDrag: () => {
      if (pull.value < PULL_THRESHOLD) return;
      /* Let go past the line and the thread is already gone — the pager
         bounces back to where a new one would be anyway. */
      runOnJS(startNewThread)();
    },
  });

  /* The composer stays mounted and rides two things at once: the pager, so it
     slides away under the thumb as you drag toward the thread list instead of
     being thrown off-screen after the fact; and the keyboard, on the UI thread,
     so it comes up with the keys rather than chasing them. */
  const keyboard = useAnimatedKeyboard();
  const insets = useSafeAreaInsets();

  /**
   * How far the keyboard actually covers the dock.
   *
   * The keyboard reports its height from the bottom of the *window*, but the
   * dock already sits inside the safe area — lifting it by the raw height
   * counts the home indicator twice and leaves a gap above the keys.
   */
  const overlap = useDerivedValue(() =>
    Math.max(keyboard.height.value - insets.bottom, 0),
  );

  const dockStyle = useAnimatedStyle(() => {
    const parked = dockHeight + spacing.xl;
    const tucked = interpolate(
      progress.value,
      [THREADS_PAGE, THREAD_PAGE],
      [parked, 0],
      Extrapolation.CLAMP,
    );
    return { transform: [{ translateY: tucked - overlap.value }] };
  });

  /**
   * How far to raise anything that wants to sit in the middle of the page.
   *
   * The composer covers the bottom, and the keyboard pushes the composer
   * further up still. Losing height off one end moves the centre of what's
   * left by half of it. The greeting and the pull badge both ride this, so
   * they stay on each other's line in every state instead of each being
   * centred against something slightly different.
   */
  const centreLift = useDerivedValue(() => (dockHeight + overlap.value) / 2);

  /**
   * The thread list is live now, but there's still no conversation view for a
   * message to land in, so sending only names the tab — roughly what the real
   * titling does with a first message.
   */
  const handleSend = (text: string) => {
    /* Nothing to send into yet, so a message can only ever start a fresh
       thread — which means letting go of whichever one the list opened. */
    setThreadId(null);
    setTitle(asTabTitle(text));
  };

  /** Opening a thread from the list is a move to the second page, wearing its name. */
  const openThread = (thread: ThreadSummary) => {
    setThreadId(thread.id);
    setTitle(asTabTitle(thread.title));
    /* A thread you've had is on the record by definition. */
    setIncognito(false);
    goTo(THREAD_PAGE);
  };

  /* Deleted from under us — the pager can't keep showing a thread that no
     longer exists, so it falls back to an empty one. */
  const handleThreadDeleted = (deletedId: ThreadId) => {
    if (deletedId !== threadId) return;
    setThreadId(null);
    setTitle(UNTITLED);
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSignOutError(null);
    setSigningOut(true);

    try {
      // The signed-in guard sends us back to /sign-in on its own.
      await signOut();
    } catch (cause) {
      setSignOutError(describeClerkError(cause));
      setSigningOut(false);
    }
  };

  const name = user?.firstName?.trim() || "there";
  const email = user?.primaryEmailAddress?.emailAddress;
  const initials = (user?.firstName?.[0] ?? email?.[0] ?? "?").toUpperCase();

  return (
    <Screen contentStyle={styles.content} keyboardAvoiding={false}>
      <TopBar
        tabs={tabs}
        progress={progress}
        activeIndex={page}
        onSelectTab={goTo}
        onNewThread={startNewThread}
        avatarUri={user?.imageUrl}
        initials={initials}
        onOpenAccount={() => setAccountOpen(true)}
        /* Nothing to make private about a thread that hasn't started, so the
           toggle only stands in for the new-thread button on an empty one —
           or on one that's already off the record, since otherwise naming the
           thread would take away the only way back out of the mode. */
        showIncognito={onThread && (incognito || title === UNTITLED)}
        incognito={incognito}
        onToggleIncognito={() => setIncognito((on) => !on)}
      />

      {/* The pull badge shares this box with the pager so it centres against
          the pager rather than against the whole screen. */}
      <View style={styles.stage}>
        <Animated.ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          /* The rubber band past the last page is the whole gesture, so it
             has to be allowed to happen even with only two pages. */
          alwaysBounceHorizontal
          onMomentumScrollEnd={(event) =>
            setPage(Math.round(event.nativeEvent.contentOffset.x / width))
          }
          contentOffset={{ x: THREAD_PAGE * width, y: 0 }}
          /* `contentOffset` is honoured on iOS but not reliably on Android,
             and landing on the wrong page would leave the pill pointing at a
             tab the pager isn't on. Setting it again once we have a width
             covers both. */
          onLayout={() =>
            pager.current?.scrollTo({ x: page * width, animated: false })
          }
          style={styles.pager}
        >
          <View style={[styles.page, { width }]}>
            <ThreadsPage
              activeThreadId={threadId}
              onOpenThread={openThread}
              onThreadDeleted={handleThreadDeleted}
            />
          </View>
          <View style={[styles.page, { width }]}>
            <GreetingPage
              name={name}
              incognito={incognito}
              lift={centreLift}
            />
          </View>
        </Animated.ScrollView>

        <NewThreadPull pull={pull} lift={centreLift} />
      </View>

      {/* Docked over the pager rather than under it, so moving it never
          resizes the page it was sitting on. Transform only, always: a fade
          would put alpha over the composer's own glass and kill the effect. */}
      <Animated.View
        pointerEvents={onThread ? "auto" : "none"}
        onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}
        style={[styles.dock, dockStyle]}
      >
        <Composer
          model={MODEL}
          onSend={handleSend}
          onAttach={() => {}}
          placeholder={incognito ? "Ask off the record" : "Ask anything"}
        />
      </Animated.View>

      {accountOpen ? (
        <AccountSheet
          email={email}
          signingOut={signingOut}
          error={signOutError}
          onSignOut={handleSignOut}
          onDismiss={() => setAccountOpen(false)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    // The bar sits at the top; the pager runs edge to edge under it.
    paddingHorizontal: 0,
    paddingTop: spacing.sm,
    paddingBottom: 0,
  },
  stage: {
    flex: 1,
  },
  pager: {
    flex: 1,
  },
  page: {
    // Stretches the page to the pager's height so its content can centre.
    alignSelf: "stretch",
  },
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
});
