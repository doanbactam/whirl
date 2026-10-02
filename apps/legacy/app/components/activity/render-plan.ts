import type { Phase } from "~/data/messages";
import type { ChipPhase } from "~/components/activity/phase-chip";

/**
 * Every phase renders inline at its content offset, pending or not — a pending
 * chip IS the live indicator (it morphs into its finalized form in place).
 * Only the retired generative-UI phase renders nothing — and an mcp call that
 * hasn't named its integration yet: mounting the generic plug + "Using a
 * tool" just to swap in the real branding a beat later reads as a flash, so
 * the chip waits for the names (stamped mid-stream from the call's first
 * input chunk) and arrives branded.
 */
export function shouldRenderPhase(phase: Phase) {
  if (phase.kind === "mcp" && phase.pending && !phase.server) return false;
  return phase.kind !== "ui";
}

type SegmentEntry = {
  startOffset: number;
  text: string;
  phaseAfter?: { phase: Phase; index: number };
};

function buildSegments(content: string, phases: Phase[]) {
  const positioned = phases
    .map((phase, index) => ({ phase, index, offset: phase.contentOffset }))
    .filter(
      (entry): entry is { phase: Phase; index: number; offset: number } =>
        typeof entry.offset === "number",
    )
    .sort((a, b) => a.offset - b.offset);
  const tail = phases
    .map((phase, index) => ({ phase, index }))
    .filter(({ phase }) => typeof phase.contentOffset !== "number");

  const segments: SegmentEntry[] = [];
  let cursor = 0;
  for (const { phase, index, offset } of positioned) {
    const clamped = Math.max(cursor, Math.min(offset, content.length));
    segments.push({
      startOffset: cursor,
      text: content.slice(cursor, clamped),
      phaseAfter: { phase, index },
    });
    cursor = clamped;
  }
  segments.push({
    startOffset: cursor,
    text: content.slice(cursor),
  });
  return { segments, tail };
}

export type ChipEntry = { phase: ChipPhase; index: number };

export type RenderItem =
  | { type: "text"; key: string; text: string; startOffset: number }
  | { type: "phase"; key: string; phase: Phase; index: number }
  | { type: "group"; key: string; chips: ChipEntry[] };

// The chip kinds that chain into one collapsed "Did N things" group when the
// model strings tool calls together with no prose between them. Weather,
// store suggestions and images are excluded — they finalize into full
// widgets/cards that break the visual run anyway.
const CHAINABLE_KINDS: ReadonlySet<Phase["kind"]> = new Set([
  "thought",
  "search",
  "fetch",
  "calc",
  "mcp",
  "skill",
  "history",
]);

// Thoughts ride along inside a chain, but only actual tool calls decide
// whether one forms — the classic lone "thought + search" pair keeps its
// two chips.
const TOOL_KINDS: ReadonlySet<Phase["kind"]> = new Set([
  "search",
  "fetch",
  "calc",
  "mcp",
  "skill",
  "history",
]);

function isChainable(phase: Phase): phase is ChipPhase {
  return CHAINABLE_KINDS.has(phase.kind);
}

/**
 * Flatten a reply into its render order: prose blocks, standalone phases and
 * chained tool-call groups. A run of back-to-back chainable chips (no prose
 * between) collapses into one group item once it holds at least two tool
 * calls; anything shorter renders as the individual chips it always was.
 * Keys stay stable while a stream appends — text is keyed by its content
 * offset, phases and groups by the index of their (first) phase.
 */
export function buildRenderPlan(
  content: string,
  phases: Phase[],
): RenderItem[] {
  const { segments, tail } = buildSegments(content, phases);
  const items: RenderItem[] = [];
  let run: ChipEntry[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    const toolCalls = run.filter(({ phase }) => TOOL_KINDS.has(phase.kind));
    if (toolCalls.length >= 2) {
      items.push({ type: "group", key: `group-${run[0].index}`, chips: run });
    } else {
      for (const { phase, index } of run) {
        if (!shouldRenderPhase(phase)) continue;
        items.push({ type: "phase", key: `phase-${index}`, phase, index });
      }
    }
    run = [];
  };

  const pushPhase = (phase: Phase, index: number) => {
    if (isChainable(phase)) {
      // A still-anonymous mcp call stays hidden on its own (the bottom status
      // row bridges until it's named) — but inside a run the group is already
      // the live indicator, so it joins right away behind the working verbs.
      if (!shouldRenderPhase(phase) && run.length === 0) return;
      run.push({ phase, index });
      return;
    }
    if (!shouldRenderPhase(phase)) return;
    flushRun();
    items.push({ type: "phase", key: `phase-${index}`, phase, index });
  };

  for (const seg of segments) {
    if (seg.text.trim().length > 0) {
      flushRun();
      items.push({
        type: "text",
        key: `text-${seg.startOffset}`,
        text: seg.text,
        startOffset: seg.startOffset,
      });
    }
    if (seg.phaseAfter) pushPhase(seg.phaseAfter.phase, seg.phaseAfter.index);
  }
  for (const { phase, index } of tail) {
    pushPhase(phase, index);
  }
  flushRun();
  return items;
}
