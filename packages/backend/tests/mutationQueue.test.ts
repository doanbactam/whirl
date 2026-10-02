import { expect, test } from "bun:test";

import { createMutationQueue } from "../convex/inference/mutationQueue";

test("runs mutations in launch order without overlap", async () => {
  const started: number[] = [];
  const finished: number[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const ctx = {
    runMutation: async (_reference: unknown, args: { id: number }) => {
      started.push(args.id);
      if (args.id === 1) await firstGate;
      finished.push(args.id);
      return args.id;
    },
  };
  const runMutation = createMutationQueue(ctx as never);

  const first = runMutation({} as never, { id: 1 } as never);
  const second = runMutation({} as never, { id: 2 } as never);
  await Promise.resolve();

  expect(started).toEqual([1]);
  releaseFirst();
  await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
  expect(started).toEqual([1, 2]);
  expect(finished).toEqual([1, 2]);
});

test("continues after a queued mutation fails", async () => {
  const calls: number[] = [];
  const ctx = {
    runMutation: async (_reference: unknown, args: { id: number }) => {
      calls.push(args.id);
      if (args.id === 1) throw new Error("boom");
      return args.id;
    },
  };
  const runMutation = createMutationQueue(ctx as never);

  const first = runMutation({} as never, { id: 1 } as never);
  const second = runMutation({} as never, { id: 2 } as never);

  await expect(first).rejects.toThrow("boom");
  await expect(second).resolves.toBe(2);
  expect(calls).toEqual([1, 2]);
});
