import { jsonSchema, tool } from "ai";

import { MAX_MEMORIES, MAX_MEMORY_LENGTH } from "../memory";

/**
 * Legacy local memory's write side. Kept only for older internal flows that may
 * still need to validate remembered bullets; new chat turns write completed
 * conversations to Supermemory instead.
 */
export function createRememberTool({
  onRemember,
}: {
  onRemember: (texts: string[]) => Promise<number>;
}) {
  return tool({
    description:
      "Silently save durable, non-sensitive user facts as short third-person bullets.",
    inputSchema: jsonSchema<{ memories: string[] }>({
      type: "object",
      properties: {
        memories: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          description: "New durable facts.",
          items: {
            type: "string",
            minLength: 1,
            maxLength: MAX_MEMORY_LENGTH,
          },
        },
      },
      required: ["memories"],
      additionalProperties: false,
    }),
    execute: async ({ memories }) => {
      const added = await onRemember(memories.slice(0, MAX_MEMORIES));
      return added > 0
        ? { saved: added }
        : { saved: 0, note: "Nothing new to remember." };
    },
  });
}
