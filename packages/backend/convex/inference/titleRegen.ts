import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { THREAD_TITLE_FROM_TRANSCRIPT_SYSTEM_PROMPT } from "../prompts";
import { requestTitleFromModel } from "./titles";

/** Per-message clip: a title needs the gist of a turn, never the whole essay. */
const MESSAGE_MAX_CHARS = 600;
/** Whole-transcript budget — this is a 24-token call, not a summarizer. */
const TRANSCRIPT_MAX_CHARS = 4_000;
/** Opening turns always survive the trim: they set the topic. */
const HEAD_MESSAGES = 2;

type TranscriptMessage = { role: "user" | "assistant"; content: string };

function clip(text: string, limit: number) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1)}…` : cleaned;
}

/**
 * The thread as a plain-text transcript, trimmed from the middle.
 *
 * Threads outgrow any sane prompt budget, and a title cares about the two ends:
 * where the conversation started and where it ended up. So we keep the opening
 * turns, fill what's left from the newest turns backwards, and say out loud how
 * much was dropped in between.
 */
export function buildTitleTranscript(messages: TranscriptMessage[]): string {
  const lines = messages
    .map(
      (message) =>
        `${message.role === "user" ? "User" : "Assistant"}: ${clip(
          message.content,
          MESSAGE_MAX_CHARS,
        )}`,
    )
    .filter((line) => line.length > "Assistant: ".length);
  if (lines.length === 0) return "";

  const head = lines.slice(0, HEAD_MESSAGES);
  let budget =
    TRANSCRIPT_MAX_CHARS - head.reduce((total, line) => total + line.length, 0);

  const tail: string[] = [];
  for (let index = lines.length - 1; index >= head.length; index -= 1) {
    const line = lines[index];
    if (line.length > budget) break;
    budget -= line.length;
    tail.unshift(line);
  }

  const dropped = lines.length - head.length - tail.length;
  return [
    ...head,
    ...(dropped > 0
      ? [`(${dropped} message${dropped === 1 ? "" : "s"} omitted)`]
      : []),
    ...tail,
  ].join("\n\n");
}

/**
 * Re-name a thread from everything in it, not just its opening line.
 *
 * A miss leaves the existing title exactly where it was — the point of asking
 * for a new one is that you liked the thread, not that you wanted it wiped.
 * Either way the mutation clears `titleStatus`, so the shimmer always stops.
 */
export async function regenerateThreadTitleFromThread({
  ctx,
  threadId,
  userId,
}: {
  ctx: ActionCtx;
  threadId: Id<"threads">;
  userId: string;
}) {
  const messages: TranscriptMessage[] = await ctx.runQuery(
    internal.memoryIndex.getThreadTranscript,
    { threadId, userId },
  );
  const transcript = buildTitleTranscript(messages);

  const title = transcript
    ? await requestTitleFromModel({
        ctx,
        threadId,
        system: THREAD_TITLE_FROM_TRANSCRIPT_SYSTEM_PROMPT,
        prompt: `Conversation:\n${transcript}\n\nTitle:`,
        eventName: "thread_title_regenerated",
        customerId: userId,
      })
    : null;

  await ctx.runMutation(internal.inference.finishTitleRegeneration, {
    threadId,
    ...(title ? { title } : {}),
  });
}
