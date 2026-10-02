import type { TablerIcon } from "@tabler/icons-react";
import {
  IconBrain,
  IconBrush,
  IconBuildingStore,
  IconCalculator,
  IconCloud,
  IconHistory,
  IconLink,
  IconPlug,
  IconSchool,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react";

import type { MessageStatus, Phase } from "~/data/messages";

/**
 * Every live "the model is busy" state is described by one ActivityKind. To
 * teach the indicator a new tool, add a kind here and an entry in ACTIVITIES —
 * the rendering, animation and verb rotation all flow from this registry, so
 * nothing else needs to change.
 */
export type ActivityKind =
  | "thinking"
  | "searching"
  | "fetching"
  | "calculating"
  | "weather"
  | "mcp"
  | "skill"
  | "store"
  | "history"
  | "painting"
  // A bare, text-free state: just three brightening dots. Shown before the
  // first token when the user hasn't turned thinking on, and for any other
  // stretch of inactivity — we never surface a labeled "working" row.
  | "loading";

type ActivityDef = {
  icon: TablerIcon;
  /** Silly rotating verbs. We never surface the raw reasoning or query. */
  verbs: string[];
};

// Whimsical verbs shown while the model is thinking.
const THINKING_VERBS = [
  "Pondering",
  "Noodling",
  "Mulling it over",
  "Cogitating",
  "Ruminating",
  "Brewing thoughts",
  "Chewing on it",
  "Connecting the dots",
  "Untangling ideas",
  "Percolating",
  "Galaxy-braining",
  "Spinning the gears",
  "Consulting the vibes",
  "Wrangling neurons",
  "Daydreaming productively",
  "Doing a big think",
];

// Silly verbs shown while a search is in flight — never the actual query.
const SEARCHING_VERBS = [
  "Sniffing around",
  "Rummaging",
  "Scouring the stacks",
  "Digging deeper",
  "Hunting for clues",
  "Combing through",
  "Peeking under rocks",
  "Spelunking",
  "Snooping",
  "Foraging",
  "Tracking it down",
  "Rifling through",
  "Following breadcrumbs",
  "Consulting the oracle",
  "Interrogating the web",
];

// Silly verbs shown while a page fetch is in flight — never the actual URL.
const FETCHING_VERBS = [
  "Opening the link",
  "Skimming the page",
  "Reading the fine print",
  "Pulling up the page",
  "Loading the goods",
  "Fetching the page",
  "Diving into the link",
  "Absorbing the page",
  "Scanning the article",
  "Peeking at the source",
  "Retrieving the page",
  "Getting the scoop",
];

// Silly verbs shown while the weather tool is in flight.
const WEATHER_VERBS = [
  "Checking the skies",
  "Reading the clouds",
  "Consulting the barometer",
  "Licking a finger",
  "Peeking outside",
  "Sniffing the breeze",
  "Tapping the weather glass",
  "Asking the clouds",
];

// Silly verbs shown while the calculator tool is crunching — never the formula.
const CALCULATING_VERBS = [
  "Crunching numbers",
  "Doing the math",
  "Carrying the one",
  "Counting on fingers",
  "Summoning the abacus",
  "Punching the calculator",
  "Wrangling digits",
  "Running the numbers",
  "Solving for x",
  "Tallying it up",
  "Consulting Pythagoras",
  "Balancing the equation",
];

// Silly verbs shown while an image is being painted — never the prompt.
const PAINTING_VERBS = [
  "Mixing the paints",
  "Sketching it out",
  "Filling the canvas",
  "Chasing the light",
  "Squinting at the easel",
  "Adding brushstrokes",
  "Picking a palette",
  "Framing the shot",
  "Conjuring pixels",
  "Waiting for it to dry",
];

// Silly verbs shown while the integration store is being searched — never the
// actual query (the matches land in the finalized card).
const STORE_VERBS = [
  "Window shopping",
  "Browsing the shelves",
  "Checking the store",
  "Perusing the catalog",
  "Scanning the aisles",
  "Asking the shopkeeper",
  "Flipping through listings",
  "Hunting for a good fit",
];

// Silly verbs shown while a skill's instructions are being loaded — never the
// skill name (that lands in the finalized chip).
const SKILL_VERBS = [
  "Hitting the books",
  "Cramming",
  "Studying up",
  "Taking notes",
  "Reading the manual",
  "Skimming the syllabus",
  "Practicing the moves",
  "Learning the ropes",
  "Doing the homework",
  "Sharpening a pencil",
];

// Silly verbs shown while the user's past chats are being searched — never
// the actual query (the match count lands in the finalized chip).
const HISTORY_VERBS = [
  "Reminiscing",
  "Flipping through old chats",
  "Dusting off the archives",
  "Checking the receipts",
  "Rewinding the tape",
  "Thumbing through memories",
  "Digging up old threads",
  "Consulting the scrollback",
  "Blowing off the cobwebs",
  "Strolling down memory lane",
];

// Silly verbs shown while a user-connected MCP tool is running — never the
// server or tool name (that lands in the finalized chip).
const MCP_VERBS = [
  "Phoning a friend",
  "Calling in a favor",
  "Pulling some strings",
  "Tapping an old contact",
  "Asking around",
  "Ringing the help desk",
  "Reaching out",
  "Delegating",
];

export const ACTIVITIES: Record<ActivityKind, ActivityDef> = {
  thinking: { icon: IconBrain, verbs: THINKING_VERBS },
  searching: { icon: IconSearch, verbs: SEARCHING_VERBS },
  fetching: { icon: IconLink, verbs: FETCHING_VERBS },
  calculating: { icon: IconCalculator, verbs: CALCULATING_VERBS },
  weather: { icon: IconCloud, verbs: WEATHER_VERBS },
  mcp: { icon: IconPlug, verbs: MCP_VERBS },
  skill: { icon: IconSchool, verbs: SKILL_VERBS },
  store: { icon: IconBuildingStore, verbs: STORE_VERBS },
  history: { icon: IconHistory, verbs: HISTORY_VERBS },
  painting: { icon: IconBrush, verbs: PAINTING_VERBS },
  // "loading" renders as bare dots (see LiveActivity) — no icon or verb, so
  // these are placeholders that are never actually read.
  loading: { icon: IconSparkles, verbs: [] },
};

/** Map a phase to the activity it represents while it's still in flight. */
export function phaseActivityKind(phase: Phase): ActivityKind {
  switch (phase.kind) {
    case "thought":
      return "thinking";
    case "search":
      return "searching";
    case "fetch":
      return "fetching";
    case "calc":
      return "calculating";
    case "weather":
      return "weather";
    case "mcp":
      return "mcp";
    case "skill":
      return "skill";
    case "integrationSuggestion":
      return "store";
    case "history":
      return "history";
    case "image":
      return "painting";
    default:
      // Any other/unknown busy state falls back to the bare loading dots.
      return "loading";
  }
}

/** Map a bare message status to an activity kind (when no phase is active). */
export function statusActivityKind(
  status: MessageStatus | undefined,
): ActivityKind {
  return status === "searching" ? "searching" : "thinking";
}
