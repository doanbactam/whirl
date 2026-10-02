// Loop control for the agentic tool phase. The old policy capped raw call
// counts (a total budget + per-tool ceilings), which strangled legitimate
// multi-integration tasks: a Stripe→Gmail errand needs 8+ gateway calls, and
// retiring a tool mid-task stranded the model without the one tool it still
// needed. A stuck model doesn't look like "many calls" — it looks like the
// SAME call repeated with the SAME input. So progress, not volume, is the
// signal: identical repeats draw a warning, persistent repeats or a truly
// runaway call count force one final tool-free step, and the last allowed
// step is always reserved for the answer so a turn can never end silently
// mid-loop.

// Runaway backstop, far above what any real task uses. This is not a working
// budget — repetition detection breaks loops long before this — it only stops
// a pathological model that spins with ever-changing inputs from burning
// tokens forever.
export const RUNAWAY_TOOL_CALL_LIMIT = 30;

// The same exact call (tool + input) this many times means the warning was
// ignored and more steps won't help: land the reply.
const MAX_IDENTICAL_CALLS = 3;

// Duplicated calls tolerated across the whole reply (even spread over several
// different signatures) before the loop is called off.
const MAX_DUPLICATE_CALLS = 6;

// Swapped in as the system prompt suffix for the forced final step. Cutting
// tools silently (toolChoice "none" with no explanation) reads as a
// malfunction to some models, and they respond by dumping their would-be tool
// loop as plain text — this tells them the tool phase is over and what a real
// final reply looks like.
// Swapped in for the step after an askUserQuestion call: the form is on
// screen and the turn must end so the user can actually answer it. Without
// this, models keep tool-looping past their own question or answer it
// themselves in prose.
export const ASK_QUESTION_WRAPUP_INSTRUCTION =
  "Your question form is on the user's screen now and tool use for this reply is over. End your turn with at most one short sentence pointing at the form, or nothing at all. Do not repeat the questions in prose, answer them yourself, or promise background work — the user's answers arrive as their next message.";

/* The riskiest moment for scratch work reaching the user: the model has
   been in the tool loop, gets cut off, and has to switch voices in one
   step. So this repeats the voice rule from OUTPUT_HYGIENE rather than
   assuming it carried across. */
export const FINAL_RESPONSE_SYSTEM_INSTRUCTION =
  "Tool use for this reply is over; no tool can be called anymore. Write the final reply to the user now from what the conversation and tool results already contain. Write it to them, in second person: nothing in it may refer to the user in the third person, recap what you were doing, or read as the tail of your own reasoning. If part of the task could not be finished, say plainly what got done and what remains; never promise to keep working in the background. Do not output planning notes, progress narration, tool names, or intentions to call tools.";

/**
 * Injected mid-loop the moment the model repeats a call it already made.
 * Repeats are almost always the start of a spiral — the model didn't like a
 * result and is rolling the dice again. One pointed nudge usually snaps it
 * back to making progress; if it doesn't, decideToolStep forces the final
 * response a couple of repeats later.
 */
export function buildRepeatedCallsInstruction(
  repeatedTools: readonly string[],
): string {
  return `You have repeated an identical call (same tool, same input) to: ${repeatedTools.join(
    ", ",
  )}. An identical call returns the identical result — reuse what it already returned instead of calling it again. If a result was not what you needed, change the input or the approach, and if no approach is left, finish the reply and tell the user plainly what you found and what you could not.`;
}

export type ToolCallRecord = {
  toolName: string;
  input?: unknown;
};

export type ToolStep = {
  toolCalls: readonly (ToolCallRecord | undefined)[];
};

export type ToolStepDecision = {
  forceFinalResponse: boolean;
  /** Tools the model has called more than once with identical input. */
  repeatedTools: string[];
  totalToolCalls: number;
  duplicateToolCalls: number;
};

// Tool inputs are JSON the SDK already parsed, so stringify can't cycle — but
// a tool could hand back something exotic, and loop policy must never be the
// thing that crashes a stream.
function callSignature(call: ToolCallRecord): string {
  try {
    return `${call.toolName} ${JSON.stringify(call.input)}`;
  } catch {
    return `${call.toolName} ${String(call.input)}`;
  }
}

/**
 * Decide, before each step, whether the model is still making progress or the
 * reply needs to land. Every tool stays available until the turn is over —
 * tools are never retired individually anymore, because a model stranded
 * without the tool it needs narrates instead of answering.
 */
export function decideToolStep(
  steps: readonly ToolStep[],
  options: { maxSteps: number },
): ToolStepDecision {
  const signatureCounts = new Map<string, number>();
  const repeatedTools = new Set<string>();
  let totalToolCalls = 0;
  let duplicateToolCalls = 0;
  let maxIdenticalCalls = 0;

  for (const step of steps) {
    for (const call of step.toolCalls) {
      if (!call) continue;
      totalToolCalls += 1;
      const signature = callSignature(call);
      const count = (signatureCounts.get(signature) ?? 0) + 1;
      signatureCounts.set(signature, count);
      if (count > 1) {
        duplicateToolCalls += 1;
        repeatedTools.add(call.toolName);
        if (count > maxIdenticalCalls) maxIdenticalCalls = count;
      }
    }
  }

  // The upcoming step is the last one stopWhen allows: make it the answer
  // instead of letting the SDK guillotine the turn mid-tool-loop (which used
  // to end streams with tool calls and no reply text at all).
  const outOfSteps = steps.length >= options.maxSteps - 1;
  const runaway = totalToolCalls >= RUNAWAY_TOOL_CALL_LIMIT;
  const looping =
    maxIdenticalCalls >= MAX_IDENTICAL_CALLS ||
    duplicateToolCalls >= MAX_DUPLICATE_CALLS;

  return {
    forceFinalResponse: outOfSteps || runaway || looping,
    repeatedTools: [...repeatedTools],
    totalToolCalls,
    duplicateToolCalls,
  };
}
