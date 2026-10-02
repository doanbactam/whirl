import type { QueuedTurn } from "@/components/composer-queue";
import type { FixtureArtifacts } from "@/lib/live-artifacts";
import type { ChatMessage, WeatherDay, WeatherHour } from "@/lib/messages";

/* Canned transcripts for /debug — every state the thread view can wear,
   without needing a backend in the mood to produce them. */

const BASE_TIME = 1_752_000_000_000;

let counter = 0;
function stamp() {
  counter += 1;
  return { id: `debug-${counter}`, createdAt: BASE_TIME + counter * 1000 };
}

function user(content: string, extra?: Partial<ChatMessage>): ChatMessage {
  return { ...stamp(), role: "user", content, ...extra };
}

function assistant(
  content: string,
  extra?: Partial<ChatMessage>,
): ChatMessage {
  return {
    ...stamp(),
    role: "assistant",
    content,
    status: "complete",
    ...extra,
  };
}

/* A local SVG thumb so the attachment scenario never waits on (or leaks
   to) the network. */
const SAMPLE_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a8a8a"/><stop offset="1" stop-color="#2e2e2e"/></linearGradient></defs><rect width="320" height="200" fill="url(#g)"/><circle cx="240" cy="60" r="28" fill="#f0f0f0" opacity="0.85"/><path d="M0 160 L80 100 L150 150 L230 90 L320 150 L320 200 L0 200 Z" fill="#1c1c1c" opacity="0.6"/></svg>`,
  );

const MARKDOWN_REPLY = `## Prognosis: extremely whirlable

Here's the honest breakdown of your idea, with the usual caveats.

### What's working

- **Momentum** — the core loop is genuinely fun
- **Scope** — small enough to ship before the heat death of the universe
- *Naming* — \`whirl\` was, frankly, inspired

### The numbers

| Metric | Before | After |
| --- | --- | --- |
| Time to first chat | 4.2s | 0.8s |
| Rage clicks | 17 | 0 |
| Vibes | mid | immaculate |

### A snippet, because of course

\`\`\`ts
export function whirl(input: string): string {
  const spun = [...input].reverse().join("");
  return spun === input ? "palindrome!" : spun;
}
\`\`\`

> Fun fact: inline code like \`array.reverse()\` mutates in place, which has ruined at least one of my afternoons.

More at [convex.dev](https://convex.dev) — and that's the whole tour.`;

const THOUGHT_TEXT = `The user wants a comparison of the two approaches. Key considerations:

1. The optimistic update path is simpler but can flicker on rollback.
2. The pending-bridge path needs a store but survives navigation.

The second is more robust for this app's shell, since the composer stays mounted across faces. I'll recommend it, with the caveat about cleanup on echo.`;

/* ---- Weather fixtures ------------------------------------------------ */

const WEATHER_HOURLY: WeatherHour[] = Array.from({ length: 12 }, (_, i) => ({
  time: `2026-07-20T${String(9 + i).padStart(2, "0")}:00`,
  temp: 19 + Math.round(Math.sin(i / 2.4) * 4),
  code: i < 3 ? 2 : i < 6 ? 3 : i < 9 ? 61 : 2,
  precipProb: i >= 6 && i < 9 ? 35 + i * 5 : 0,
}));

const WEATHER_DAILY: WeatherDay[] = [
  { date: "2026-07-20", code: 2, max: 24, min: 16, precipProb: 10 },
  { date: "2026-07-21", code: 0, max: 26, min: 17 },
  { date: "2026-07-22", code: 3, max: 22, min: 15, precipProb: 20 },
  { date: "2026-07-23", code: 61, max: 19, min: 14, precipProb: 70 },
  { date: "2026-07-24", code: 80, max: 20, min: 13, precipProb: 55 },
  { date: "2026-07-25", code: 1, max: 25, min: 15 },
  { date: "2026-07-26", code: 0, max: 27, min: 17 },
];

/* ---- Artifact fixtures ----------------------------------------------- */

const DOC_BODY = `# The Whirl Manifesto

Chat apps got heavy. Whirl stays light — one composer, no ceremony, and the
model does the showing off.

## The rules

1. **Fast beats fancy** — first paint before first doubt.
2. **Flat beats deep** — no shadows pretending to be hierarchy.
3. *Whimsy is load-bearing.*

## The fine print

> Documents like this one stream in live, and you can watch the words land
> in the side panel while the reply keeps going.

That's the whole manifesto. Short on purpose.`;

const VIZ_HTML = `<style>
  .wrap { padding-bottom: 26px; }
  .chart { display: flex; align-items: flex-end; gap: 10px; height: 150px; }
  .bar { flex: 1; position: relative; border-radius: 8px 8px 3px 3px;
         background: var(--whirl-accent-soft); border: 1px solid var(--whirl-accent); }
  .bar span { position: absolute; bottom: -22px; left: 0; right: 0;
              text-align: center; font-size: 11px; color: var(--whirl-muted); }
</style>
<div class="wrap">
  <div class="chart">
    <div class="bar" style="height: 34%"><span>Mon</span></div>
    <div class="bar" style="height: 52%"><span>Tue</span></div>
    <div class="bar" style="height: 41%"><span>Wed</span></div>
    <div class="bar" style="height: 78%"><span>Thu</span></div>
    <div class="bar" style="height: 96%"><span>Fri</span></div>
  </div>
</div>`;

/* Deliberately wider and taller than a narrow chat pane. The Artifacts
   workbench scenario keeps this beside another inline visual so resizing
   the sidebar exercises width containment, internal scrolling, and
   multiple-card flow without a backend. */
const OVERSIZED_VIZ_HTML = `<style>
  .board { width: 960px; min-height: 900px; padding: 18px; border-radius: 14px;
           background: var(--whirl-surface); border: 1px solid var(--whirl-border); }
  .rail { display: grid; grid-template-columns: repeat(6, 140px); gap: 12px; }
  .tile { height: 120px; padding: 12px; border-radius: 10px;
          background: var(--whirl-surface-2); }
</style>
<div class="board">
  <strong>Oversized visualization workbench</strong>
  <p>Scroll this stage, not the surrounding chat layout.</p>
  <div class="rail">
    ${Array.from({ length: 18 }, (_, index) => `<div class="tile">Tile ${index + 1}</div>`).join("")}
  </div>
</div>`;

const PAGE_HTML = `<style>
  .hero { padding: 56px 24px 40px; text-align: center; }
  .hero h1 { margin: 0 0 10px; font-size: 34px; letter-spacing: -0.02em; }
  .hero p { margin: 0 auto; max-width: 40ch; color: var(--whirl-muted); }
  .cta { display: inline-block; margin-top: 20px; padding: 10px 18px;
         border-radius: 999px; background: var(--whirl-accent);
         color: var(--whirl-accent-fg); text-decoration: none; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 0 24px 48px; }
  .card { background: var(--whirl-surface); border: 1px solid var(--whirl-border);
          border-radius: var(--whirl-radius); padding: 16px; }
  .card b { display: block; margin-bottom: 4px; }
  .card span { font-size: 13px; color: var(--whirl-muted); }
</style>
<div class="hero">
  <h1>Whirl</h1>
  <p>The chat app that spins up faster than your coffee order.</p>
  <a class="cta" href="#">Take it for a spin</a>
</div>
<div class="grid">
  <div class="card"><b>Fast</b><span>First paint before first doubt.</span></div>
  <div class="card"><b>Flat</b><span>No shadows pretending to be hierarchy.</span></div>
  <div class="card"><b>Fun</b><span>Whimsy is load-bearing.</span></div>
</div>`;

/** Canned artifact rows for the live hooks — /debug wraps the thread in
 * FixtureArtifactsProvider with these, so the cards and side panel resolve
 * bodies without touching Convex. */
export const FIXTURE_ARTIFACTS: FixtureArtifacts = {
  documents: {
    "fixture-doc-1": {
      title: "The Whirl Manifesto",
      status: "complete",
      content: DOC_BODY,
    },
    "fixture-doc-2": {
      title: "Slow burn",
      status: "streaming",
      content:
        "# Slow burn\n\nThe first paragraph has landed. The rest is still on its way, one word at a",
    },
  },
  html: {
    "fixture-viz-1": {
      kind: "inline",
      title: "Vibes over time",
      status: "complete",
      content: VIZ_HTML,
    },
    "fixture-viz-oversized": {
      kind: "inline",
      title: "Oversized visualization",
      status: "complete",
      content: OVERSIZED_VIZ_HTML,
    },
    "fixture-page-1": {
      kind: "full",
      title: "Whirl launch page",
      status: "complete",
      content: PAGE_HTML,
      shortId: "debug",
    },
    "fixture-page-2": {
      kind: "full",
      title: "Doomed page",
      status: "failed",
      content: "",
      error: "The builder tripped over a div and couldn't get back up.",
    },
  },
};

export type DebugScenario = {
  key: string;
  label: string;
  /** `undefined` = the loading skeleton. */
  messages: ChatMessage[] | undefined;
  /** Seeds the fake streamer instead of rendering static fixtures. */
  live?: boolean;
  /** Messages already waiting behind the live reply. */
  queued?: QueuedTurn[];
  /** What's in the composer when the scenario opens. */
  draft?: string;
  /** Show the sidebar-row fixtures beside the transcript. */
  rail?: boolean;
};

export function buildScenarios(): DebugScenario[] {
  counter = 0;
  return [
    {
      key: "conversation",
      label: "Conversation",
      messages: [
        user("Give me the full markdown tour — tables, code, the works."),
        /* Stats ride the action row when "Show stats" is on in settings. */
        assistant(MARKDOWN_REPLY, { outputTokens: 1284, durationMs: 9400 }),
        user("Nice. Now do it again but shorter."),
        assistant(
          "**Short version:** it works, it's fast, and the code block still gets a copy button. That's the tour.",
          { outputTokens: 96, durationMs: 850 },
        ),
        user(
          "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_ExampleId/edit?gid=0#gid=0",
        ),
        assistant("That link now stays in its lane."),
      ],
    },
    {
      key: "streaming",
      label: "Streaming",
      live: true,
      messages: [],
    },
    {
      key: "queue",
      label: "Queue",
      rail: true,
      draft: "And once that's done, draft the changelog entry.",
      messages: [
        user("Plan the migration off the old billing ledger."),
        assistant(
          "Three phases, and the second one is the scary one.\n\n1. **Shadow-write** both ledgers for a week and diff them nightly.\n2. **Flip reads** to the new ledger behind a flag, one plan tier at a time.\n3. **Retire** the old one once a full billing cycle matches to the cent.\n\nThe diff script is where the real work is, so here's a first cut of it",
          { status: "streaming", streamId: undefined },
        ),
      ],
      queued: [
        {
          id: "debug-queued-1",
          content: "Write the diff script as a Convex cron, not a one-off.",
        },
        {
          id: "debug-queued-2",
          content: "How do we roll back phase two if the numbers drift?",
        },
      ],
    },
    {
      key: "thinking",
      label: "Thinking",
      messages: [
        user("Think hard about optimistic updates versus pending bridges."),
        assistant("", {
          status: "thinking",
          thinking: true,
          phases: [{ kind: "thought", pending: true }],
        }),
      ],
    },
    {
      key: "phases",
      label: "Phases",
      messages: [
        user("Research it, read the sources, and use the calendar app."),
        assistant(
          "Done on all three fronts — sources agree, and the meeting is on the books.",
          {
            phases: [
              { kind: "thought", durationMs: 12_400, text: THOUGHT_TEXT },
              {
                kind: "search",
                query: "convex optimistic updates",
                sources: 2,
                items: [
                  {
                    title: "Optimistic Updates",
                    url: "https://docs.convex.dev/client/react/optimistic-updates",
                    author: "Convex",
                  },
                  {
                    title: "Mutation Functions",
                    url: "https://docs.convex.dev/functions/mutation-functions",
                    author: "Convex",
                  },
                ],
              },
              {
                kind: "fetch",
                sources: 1,
                items: [
                  {
                    title: "Optimistic Updates",
                    url: "https://docs.convex.dev/client/react/optimistic-updates",
                  },
                ],
              },
              {
                kind: "mcp",
                server: "Context7",
                tool: "mcp_list_tools",
                ok: false,
                error: "Unauthorized",
              },
              {
                kind: "mcp",
                server: "Google Calendar",
                tool: "create_event",
                ok: true,
              },
            ],
          },
        ),
        user("What if it only needed one lookup?"),
        assistant("One search was plenty.", {
          phases: [
            {
              kind: "search",
              sources: 1,
              items: [
                {
                  title: "Optimistic Updates",
                  url: "https://docs.convex.dev/client/react/optimistic-updates",
                  author: "Convex",
                },
              ],
            },
          ],
        }),
        user("And an integration that's still going?"),
        assistant("I found the right calendar and I'm adding the event now.", {
          status: "streaming",
          phases: [
            {
              kind: "mcp",
              pending: true,
              server: "Google Calendar",
              tool: "create_event",
            },
          ],
        }),
      ],
    },
    {
      key: "question",
      label: "Question",
      messages: [
        user("Redesign my portfolio site."),
        assistant("A couple of quick calls before I start sketching.", {
          phases: [
            {
              kind: "question",
              answered: true,
              questions: [
                {
                  id: "q1",
                  prompt: "Which direction should the redesign lean?",
                  header: "Direction",
                  type: "single",
                  allowOther: true,
                  options: [
                    {
                      label: "Minimal & typographic",
                      description: "Lots of whitespace, one quiet accent",
                    },
                    {
                      label: "Bold & colorful",
                      description: "Big blocks, playful energy",
                    },
                    { label: "Editorial", description: "Magazine-style grids" },
                  ],
                },
                {
                  id: "q2",
                  prompt: "Which sections matter most?",
                  header: "Sections",
                  type: "multi",
                  allowOther: true,
                  options: [
                    { label: "Projects" },
                    { label: "Writing" },
                    { label: "About" },
                    { label: "Contact" },
                  ],
                },
                {
                  id: "q3",
                  prompt: "Who is the site mostly for?",
                  header: "Audience",
                  type: "text",
                  placeholder: "Recruiters, clients, collaborators…",
                },
                {
                  id: "q4",
                  prompt: "Any brand assets to build around?",
                  header: "Assets",
                  type: "attachment",
                },
              ],
              answers: [
                { id: "q1", selected: ["Minimal & typographic"] },
                {
                  id: "q2",
                  selected: ["Projects", "Writing"],
                  text: "maybe a tiny now page",
                },
                { id: "q3", text: "Recruiters, mostly" },
                { id: "q4", attachments: ["logo.svg", "palette.png"] },
              ],
            },
          ],
        }),
        user(
          "Direction: Minimal & typographic\nSections: Projects, Writing — maybe a tiny now page\nAudience: Recruiters, mostly\nAssets: (attached: logo.svg, palette.png)",
        ),
        assistant(
          "Perfect — minimal it is. One last thing before I mock it up.",
          {
            phases: [
              {
                kind: "question",
                questions: [
                  {
                    id: "q1",
                    prompt: "Dark mode too, or light only?",
                    header: "Theme",
                    type: "single",
                    allowOther: true,
                    options: [
                      { label: "Both, synced to the system" },
                      { label: "Light only" },
                      { label: "Dark only" },
                    ],
                  },
                ],
              },
            ],
          },
        ),
      ],
    },
    {
      key: "weather",
      label: "Weather",
      messages: [
        user("What's it like outside in Lisbon?"),
        assistant(
          "Light-jacket weather — mild now, but the afternoon has rain on its mind. The week trends warmer from Friday.",
          {
            phases: [
              {
                kind: "weather",
                place: "Lisbon",
                approximate: true,
                timezone: "Europe/Lisbon",
                tempUnit: "C",
                windUnit: "km/h",
                temp: 21.4,
                apparentTemp: 20.1,
                humidity: 58,
                windSpeed: 14,
                code: 2,
                isDay: true,
                hourly: WEATHER_HOURLY,
                daily: WEATHER_DAILY,
              },
            ],
          },
        ),
        user("And somewhere the satellites can't see?"),
        assistant("No forecast for that one, sorry — even the clouds are guessing.", {
          phases: [
            { kind: "weather", error: "Couldn't find that place." },
          ],
        }),
        user("Check one more for me?"),
        assistant("", {
          status: "streaming",
          phases: [{ kind: "weather", pending: true }],
        }),
      ],
    },
    {
      key: "charts",
      label: "Charts",
      messages: [
        user("Chart the signup numbers for me."),
        assistant(
          "Q3 is where it turns — the paid line finally outgrows the churn.",
          {
            phases: [
              {
                kind: "chart",
                chart: {
                  type: "line",
                  title: "Signups by quarter",
                  subtitle: "Free and paid, last two years",
                  categories: [
                    "Q1 24",
                    "Q2 24",
                    "Q3 24",
                    "Q4 24",
                    "Q1 25",
                    "Q2 25",
                    "Q3 25",
                    "Q4 25",
                  ],
                  series: [
                    {
                      name: "Free",
                      values: [820, 1140, 980, 1520, 1810, 1740, 2260, 2890],
                    },
                    {
                      name: "Paid",
                      values: [90, 140, 210, 260, 340, null, 520, 780],
                    },
                  ],
                  yLabel: "signups",
                  format: "compact",
                  source: "From the analytics export you sent.",
                },
              },
            ],
          },
        ),
        user("Split it by plan, and show me the mix."),
        assistant("Turbo carries it — barely, and only since the price drop.", {
          phases: [
            {
              kind: "chart",
              chart: {
                type: "bar",
                title: "Revenue by plan",
                categories: ["Q1", "Q2", "Q3", "Q4"],
                stacked: true,
                series: [
                  { name: "Starter", values: [12, 14, 15, 19] },
                  { name: "Turbo", values: [28, 34, 41, 52] },
                  { name: "Team", values: [8, 9, 14, 22] },
                ],
                format: "currency",
                currency: "USD",
              },
            },
            {
              kind: "chart",
              chart: {
                type: "pie",
                title: "Where the traffic came from",
                categories: ["Search", "Referral", "Social", "Direct", "Other"],
                series: [{ name: "Visits", values: [4200, 1800, 1200, 900, 400] }],
                format: "compact",
              },
            },
          ],
        }),
        user("And the slowest endpoints?"),
        assistant("Two of these are the same query in a trench coat.", {
          phases: [
            {
              kind: "chart",
              chart: {
                type: "hbar",
                title: "Slowest endpoints",
                categories: [
                  "POST /api/threads/messages/send",
                  "GET /api/search",
                  "GET /api/threads",
                  "POST /api/upload",
                  "GET /api/me",
                ],
                series: [{ name: "p95", values: [1840, 1220, 640, 410, 90] }],
                xLabel: "milliseconds",
              },
            },
            {
              kind: "chart",
              chart: {
                type: "scatter",
                title: "Latency against payload size",
                series: [
                  {
                    name: "Requests",
                    points: [
                      { x: 12, y: 90 },
                      { x: 48, y: 140 },
                      { x: 95, y: 220 },
                      { x: 140, y: 260 },
                      { x: 210, y: 480 },
                      { x: 260, y: 410 },
                      { x: 330, y: 720 },
                      { x: 410, y: 690 },
                    ],
                  },
                ],
                xLabel: "KB",
                yLabel: "ms",
              },
            },
          ],
        }),
        user("One more, still drawing."),
        assistant("", {
          status: "streaming",
          phases: [{ kind: "chart", pending: true }],
        }),
      ],
    },
    {
      key: "artifacts",
      label: "Artifacts",
      messages: [
        user("Write me a manifesto, chart the vibes, and build a launch page."),
        assistant(
          "All three, coming right up — the manifesto opens in the side panel, the chart lives right here, and the page is one click away.",
          {
            phases: [
              {
                kind: "document",
                op: "create",
                documentId: "fixture-doc-1",
                title: "The Whirl Manifesto",
                ok: true,
              },
              {
                kind: "html",
                mode: "inline",
                op: "create",
                htmlId: "fixture-viz-1",
                title: "Vibes over time",
                ok: true,
              },
              {
                kind: "html",
                mode: "inline",
                op: "create",
                htmlId: "fixture-viz-oversized",
                title: "Oversized visualization",
                ok: true,
              },
              {
                kind: "html",
                mode: "full",
                op: "create",
                htmlId: "fixture-page-1",
                title: "Whirl launch page",
                ok: true,
              },
            ],
          },
        ),
        user("Now one still cooking, and one that flopped."),
        assistant("", {
          status: "streaming",
          phases: [
            {
              kind: "document",
              op: "create",
              documentId: "fixture-doc-2",
              title: "Slow burn",
              pending: true,
            },
            {
              kind: "html",
              mode: "full",
              op: "create",
              htmlId: "fixture-page-2",
              title: "Doomed page",
              ok: true,
            },
          ],
        }),
      ],
    },
    {
      key: "attachments",
      label: "Attachments",
      messages: [
        user("Here's the screenshot and the report — what jumps out?", {
          attachments: [
            {
              id: "att-1",
              name: "screenshot.png",
              size: 482_133,
              type: "image/png",
              url: SAMPLE_IMAGE,
            },
            {
              id: "att-2",
              name: "q3-report.pdf",
              size: 2_400_000,
              type: "application/pdf",
            },
            {
              id: "att-3",
              name: "metrics.ts",
              size: 8_921,
              type: "text/plain",
            },
          ],
        }),
        assistant(
          "The chart in the screenshot and table 4 of the report disagree by about 12% — I'd trust the report; the chart looks like it predates the October restatement.",
        ),
      ],
    },
    {
      key: "images",
      label: "Images",
      messages: [
        user("Paint me a whirlpool logo."),
        assistant("", {
          model: "Image",
          attachments: [
            {
              id: "gen-1",
              name: "whirlpool-logo.png",
              size: 1_204_000,
              type: "image/png",
              url: SAMPLE_IMAGE,
            },
          ],
        }),
        user("Now one from the paint tool, mid-reply."),
        assistant("Here's the vibe, painted fresh:", {
          phases: [
            {
              kind: "image",
              prompt: "a cozy whirlpool at dusk",
              images: [SAMPLE_IMAGE],
            },
          ],
        }),
        user("And one still painting, plus one that flopped?"),
        assistant("", {
          status: "streaming",
          phases: [
            { kind: "image", prompt: "impossible geometry", pending: true },
            { kind: "image", ok: false, error: "The paint dried mid-stroke." },
          ],
        }),
      ],
    },
    {
      key: "errors",
      label: "Errors",
      messages: [
        user("Try something that's out of my plan."),
        assistant("__AUTUMN_GATE__:usage", { status: "error" }),
        user("Okay, try again?"),
        assistant("__SERVER_OVERLOAD__", { status: "error" }),
        user("Third time's the charm."),
        assistant("AI provider error: model timed out.", { status: "error" }),
      ],
    },
    {
      key: "stopped",
      label: "Stopped",
      messages: [
        user("Write me a novel about a spinning top."),
        assistant(
          "Chapter one. The top had been spinning for eleven years, which everyone in the village agreed was *at least* nine years too many—",
          { status: "stopped" },
        ),
      ],
    },
    {
      key: "empty",
      label: "Empty",
      messages: [],
    },
    {
      key: "loading",
      label: "Loading",
      messages: undefined,
    },
  ];
}

/* What the fake streamer types out, word by word — enough markdown that
   incomplete-fence handling gets a workout mid-stream. */
export const FAKE_REPLY = MARKDOWN_REPLY;

let liveCounter = 0;

export function fakeUser(content: string): ChatMessage {
  liveCounter += 1;
  return {
    id: `debug-live-${liveCounter}-u`,
    createdAt: Date.now(),
    role: "user",
    content,
  };
}

export function fakeAssistant(): ChatMessage {
  liveCounter += 1;
  return {
    id: `debug-live-${liveCounter}-a`,
    createdAt: Date.now() + 1,
    role: "assistant",
    content: "",
    status: "thinking",
  };
}
