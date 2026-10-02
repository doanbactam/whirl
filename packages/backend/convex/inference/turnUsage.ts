// What a turn actually cost, added up as it happens.
//
// An agentic turn is not one request to OpenRouter — it's one per step, each
// separately priced, and the expensive turns are precisely the ones with the
// most steps. The AI SDK's `result.providerMetadata` is documented as coming
// from the LAST step only, so billing off it charged a fifteen-step research
// run for its closing paragraph and nothing else — and charged nothing at all
// whenever that final step came back without a usage report.
//
// So the cost is accumulated from the `finish-step` parts as they stream by.
// That also means the running total exists at every moment of the turn, which
// is what lets a stopped turn bill for the work it really did instead of
// walking away free.

import type { ProviderMetadata } from "ai";

/** OpenRouter's per-request spend, read defensively — shapes change. */
export function reportedCostUsd(metadata: unknown): number {
  const cost = (metadata as { openrouter?: { usage?: { cost?: number } } })
    ?.openrouter?.usage?.cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost > 0
    ? cost
    : 0;
}

export type TurnUsage = {
  /** Provider-reported USD across every step, plus any repair passes. */
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  steps: number;
  /** Steps that finished without telling us what they cost. */
  unpricedSteps: number;
};

export type TurnUsageMeter = {
  /** Fold in one finished step of the main generation. */
  recordStep(part: {
    usage?: { inputTokens?: number; outputTokens?: number };
    providerMetadata?: ProviderMetadata;
  }): void;
  /** Fold in a model call made outside the stream (e.g. the repair pass). */
  recordSideCall(usage: {
    costUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
  }): void;
  snapshot(): TurnUsage;
};

export function createTurnUsageMeter(): TurnUsageMeter {
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let steps = 0;
  let unpricedSteps = 0;

  return {
    recordStep(part) {
      steps += 1;
      const cost = reportedCostUsd(part.providerMetadata);
      if (cost > 0) costUsd += cost;
      else unpricedSteps += 1;
      inputTokens += part.usage?.inputTokens ?? 0;
      outputTokens += part.usage?.outputTokens ?? 0;
    },
    recordSideCall({ costUsd: cost, inputTokens: input, outputTokens: output }) {
      if (cost && cost > 0) costUsd += cost;
      inputTokens += input ?? 0;
      outputTokens += output ?? 0;
    },
    snapshot: () => ({
      costUsd,
      inputTokens,
      outputTokens,
      steps,
      unpricedSteps,
    }),
  };
}
