import { jsonSchema, tool } from "ai";

const MAX_PROMPT_LENGTH = 4_000;

/**
 * Lets whirl paint a picture mid-reply without holding the reply open: each
 * call schedules a background paint (see imageWorker.ts) and returns
 * immediately. The picture lands on the message's `image` phase when the
 * worker finishes, and the chat renders that phase as an inline picture card
 * exactly where the model made the call — so slow generations can't stall or
 * time out the stream, and the model just keeps writing.
 */
export function createGenerateImageTool({
  start,
}: {
  /** Stamp the pending `image` phase and schedule the background paint. */
  start: (args: { prompt: string; callIdx: number }) => Promise<void>;
}) {
  let callCounter = 0;
  return tool({
    description:
      "Generate one image in the background. It appears automatically in the reply.",
    inputSchema: jsonSchema<{ prompt: string }>({
      type: "object",
      properties: {
        prompt: {
          type: "string",
          minLength: 1,
          maxLength: MAX_PROMPT_LENGTH,
          description: "Specific subject, setting, style, mood, and composition.",
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    }),
    execute: async ({ prompt }) => {
      const callIdx = callCounter++;
      const cleanPrompt = prompt.trim().slice(0, MAX_PROMPT_LENGTH);
      try {
        await start({ prompt: cleanPrompt, callIdx });
        return {
          ok: true,
          status: "painting",
          note: "The image is being painted in the background and will appear in your reply automatically, exactly where you called this tool. Do not write a markdown image, URL, or placeholder for it — continue your reply and refer to the picture naturally.",
        };
      } catch (error) {
        // A failure HERE means the paint never even got scheduled (the stamp +
        // schedule mutation threw) — the worst kind of silent death, so shout.
        console.error(
          `generateImage tool failed to start the paint (call ${callIdx}):`,
          error instanceof Error ? error.message : error,
        );
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "couldn't start the image generation",
        };
      }
    },
  });
}
