import { useEffect, useState } from "react";
import { useUser } from "@clerk/tanstack-react-start";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { createFileRoute } from "@tanstack/react-router";

import { useThreadsLoading } from "~/data/threads";
import { WhirlLogo } from "~/components/whirl-logo";
import { RAINBOW_LAYER, WhirlRings } from "~/components/whirl-rings";
import { IncognitoLogo } from "~/components/incognito-logo";
import { useIncognito } from "~/lib/incognito";
import { pinRasterPath } from "~/lib/motion";
import { seo } from "~/lib/seo";

export const Route = createFileRoute("/")({
  component: Home,
  // The public landing/home: full brand title + description + canonical so
  // search and social show Whirl, not the retired waitlist page.
  head: () => seo({ url: "/" }),
});

const GREETINGS = [
  "What's up, {name}",
  "Hey there, {name}",
  "Back again, {name}?",
  "Miss me, {name}?",
  "Oh hey, {name}",
  "Howdy, {name}",
  "Look who it is",
  "Hiya, {name}",
  "Yo, {name}",
  "Greetings, {name}",
  "Fancy seeing you, {name}",
  "Ready when you are, {name}",
  "Hello hello, {name}",
  "Good to see you, {name}",
  "Rise and shine, {name}",
  "Long time no see, {name}",
  "{name} has arrived",
  "Welcome back, {name}",
  "Let's get into it, {name}",
  "Sup, {name}",
];

// No names here — you're nobody in particular while incognito. Proper casing,
// playfully ominous, all gone the moment you leave.
const INCOGNITO_TAGLINES = [
  "You're a ghost now",
  "No history, no trace",
  "Off the record",
  "This one's just between us",
  "Nothing here gets saved",
  "Shhh, you're invisible",
  "What happens here vanishes here",
  "Anonymous and untraceable",
  "Just us, no receipts",
  "Here now, gone on exit",
];

function pickDifferent(pool: string[], prev: string) {
  const options = pool.filter((item) => item !== prev);
  return options[Math.floor(Math.random() * options.length)] ?? pool[0];
}

const headerRow: Variants = {
  hidden: { opacity: 1 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const logoItem: Variants = {
  hidden: { opacity: 0, scale: 0.6, rotate: -14 },
  show: {
    opacity: 1,
    scale: 1,
    rotate: 0,
    transition: { type: "spring", stiffness: 360, damping: 20, mass: 0.9 },
  },
};

const titleItem: Variants = {
  hidden: { opacity: 0, y: 10, filter: "blur(4px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      opacity: { duration: 0.5, ease: [0.22, 0.61, 0.36, 1] },
      filter: { duration: 0.5, ease: [0.22, 0.61, 0.36, 1] },
      y: { type: "spring", stiffness: 320, damping: 28 },
    },
  },
};

function Home() {
  const { user, isLoaded } = useUser();
  const threadsLoading = useThreadsLoading();
  const incognito = useIncognito();
  const loading = !isLoaded || threadsLoading;
  // Randomized in the initializer (not an effect) so the first client paint is
  // already the real greeting — an effect swaps text after paint and flashes
  // the default for a frame. Server renders stay deterministic.
  const [greeting] = useState(() =>
    typeof window === "undefined"
      ? GREETINGS[0]
      : pickDifferent(GREETINGS, ""),
  );
  const [tagline, setTagline] = useState(INCOGNITO_TAGLINES[0]);
  const name =
    user?.firstName ||
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    "there";

  // Freshen the tagline each time you slip into incognito, so it's a different
  // little line every session. Adjusted during render (not in an effect) so the
  // incoming tagline never paints a stale line first.
  const [wasIncognito, setWasIncognito] = useState(incognito.enabled);
  // True while an incognito toggle is settling (the sidebar is mid-slide);
  // the logo's layout glide switches off for that window — see below.
  const [shellSettling, setShellSettling] = useState(false);
  if (incognito.enabled !== wasIncognito) {
    setWasIncognito(incognito.enabled);
    setShellSettling(true);
    if (incognito.enabled) {
      setTagline((prev) => pickDifferent(INCOGNITO_TAGLINES, prev));
    }
  }

  // Outlives the sidebar tuck animation (240ms) with margin; re-toggling
  // mid-window restarts the timer (the effect re-runs on `enabled`).
  useEffect(() => {
    if (!shellSettling) return;
    const id = window.setTimeout(() => setShellSettling(false), 450);
    return () => window.clearTimeout(id);
  }, [shellSettling, incognito.enabled]);

  const heading = incognito.enabled
    ? tagline
    : greeting.replaceAll("{name}", name);

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={headerRow}
      className="flex min-w-0 max-w-full flex-col items-center gap-4 px-1 text-center sm:flex-row sm:items-center sm:gap-4 sm:px-0 sm:text-left"
    >
      {/* layout gives the logo its signature glide to the side when the
          greeting mounts and recenters the row. It must switch OFF while an
          incognito toggle settles, though: the sidebar is mid-slide then, and
          motion's layout projection measures those in-between positions —
          springs chase stale targets (the logo darts around) and the
          projection's transform corrections cancel the logo crossfade
          outright. Plain reflow tracks the slide perfectly during that window. */}
      <motion.div
        layout={!shellSettling}
        variants={logoItem}
        transition={{ layout: { type: "spring", stiffness: 360, damping: 32 } }}
        transformTemplate={pinRasterPath}
        className="group relative h-10 w-10 shrink-0"
      >
        <div
          className={`flex h-10 w-10 items-center justify-center transition-opacity duration-300 ${loading ? "opacity-0" : "opacity-100"}`}
        >
          {/* No mode="wait": the box is a fixed 40px square, so the two logos
              can crossfade in place — waiting for the old one to fully exit
              made the swap read as a laggy flash of the previous icon. */}
          <AnimatePresence initial={false}>
            <motion.span
              key={incognito.enabled ? "incognito" : "whirl"}
              initial={{ opacity: 0, scale: 0.6, rotate: -12 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.6, rotate: 12 }}
              transition={{ type: "spring", stiffness: 480, damping: 26 }}
              transformTemplate={pinRasterPath}
              className="absolute inset-0 flex items-center justify-center"
            >
              {incognito.enabled ? (
                <IncognitoLogo size={40} />
              ) : (
                <WhirlLogo size={40} />
              )}
            </motion.span>
          </AnimatePresence>
        </div>
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${loading ? "opacity-100" : "opacity-0"}`}
        >
          <WhirlRings spin={loading} layers={[RAINBOW_LAYER]} />
        </span>
      </motion.div>
      {isLoaded && (
        <motion.h1
          variants={titleItem}
          initial="hidden"
          animate="show"
          className="relative min-w-0 text-[28px] font-medium leading-[1.25] tracking-tight sm:text-[40px]"
        >
          {/* Swap greeting <-> incognito tagline with a soft blur crossfade.
              shimmer-reveal lives on the span (not the h1): it paints the text
              via background-clip, so it must sit on the element holding the text
              or the text renders transparent. initial={false} lets the h1's own
              entrance own the first paint; only an actual toggle animates here.
              mode="popLayout" pops the outgoing line out of flow immediately,
              so the centered row settles on the new line's width once, at the
              moment the sidebar starts sliding — mode="wait" resized it again
              140ms in, mid-slide, which read as a jitter. */}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={incognito.enabled ? "incognito" : "normal"}
              initial={{ opacity: 0, y: 10, filter: "blur(5px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{
                opacity: 0,
                y: -8,
                filter: "blur(5px)",
                transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
              }}
              transition={{
                opacity: { duration: 0.28, ease: [0.22, 0.61, 0.36, 1] },
                filter: { duration: 0.28, ease: [0.22, 0.61, 0.36, 1] },
                y: { type: "spring", stiffness: 380, damping: 30 },
              }}
              transformTemplate={pinRasterPath}
              className="shimmer-reveal inline-block"
            >
              {heading}
            </motion.span>
          </AnimatePresence>
        </motion.h1>
      )}
    </motion.div>
  );
}
