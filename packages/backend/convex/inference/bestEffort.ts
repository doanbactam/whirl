// Run a best-effort side task with a timeout, swallowing failures. Shared by the
// streaming writer and the deferred finalize action so a slow analytics, billing
// or memory call never blocks the rest of a turn's bookkeeping — and never
// surfaces to the user, since these all run after the reply has settled.

export const POST_STREAM_TASK_TIMEOUT_MS = 4_000;

export async function bestEffort<T>(
  label: string,
  task: Promise<T>,
  timeoutMs = POST_STREAM_TASK_TIMEOUT_MS,
): Promise<T | undefined> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => {
          console.warn(`${label} timed out after ${timeoutMs}ms`);
          resolve(undefined);
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    console.error(`${label} failed`, error);
    return undefined;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
