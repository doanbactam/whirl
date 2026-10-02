import type {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from "convex/server";

import type { ActionCtx } from "../_generated/server";

type MutationReference = FunctionReference<"mutation", "public" | "internal">;

/**
 * Convex actions can launch tool handlers concurrently. If those handlers all
 * patch the same assistant message, their mutations race and pay for automatic
 * OCC retries. Keep the action's writes in launch order while preserving each
 * caller's own result and error.
 */
export function createMutationQueue(ctx: ActionCtx) {
  let tail: Promise<unknown> = Promise.resolve();

  return function runQueuedMutation<Mutation extends MutationReference>(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ): Promise<FunctionReturnType<Mutation>> {
    const result = tail.then(() => ctx.runMutation(mutation, ...args));
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
