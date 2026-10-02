import { jsonSchema, tool } from "ai";

import type { ChatHistoryMatch } from "../historySearch";

/** What lands on the message's history phase. */
export type ChatHistoryPhasePayload = {
  query: string;
  matches: number;
};

/** "June 3, 2026" — enough for the model to say "back in early June". */
function formatSentAt(sentAt: number): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(sentAt));
}

/**
 * Lets the model rummage through the user's past conversations. With memory
 * active the query runs semantically over the Supermemory transcript store,
 * so "that trip we planned" finds the planning chat however it was worded;
 * otherwise it's keyword-searched (BM25) over every stored message. Either
 * way the best excerpts come back with thread titles + dates so the model
 * can ground "that thing we talked about last week" in what was actually
 * said.
 */
export function createChatHistorySearchTool({
  semantic,
  search,
  onResult,
}: {
  /** Whether the backend searches by meaning (Supermemory) or by keyword. */
  semantic: boolean;
  search: (query: string) => Promise<ChatHistoryMatch[]>;
  onResult: (payload: ChatHistoryPhasePayload) => Promise<void>;
}) {
  return tool({
    description: semantic
      ? "Search past chats by meaning. Returns conversation excerpts with titles and dates."
      : "Keyword-search past chats. Returns excerpts with titles, speakers, and dates.",
    inputSchema: jsonSchema<{ query: string }>({
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: semantic
            ? "What you're looking for, in natural language."
            : "Distinctive words likely to appear verbatim.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    }),
    execute: async ({ query }) => {
      const trimmed = query.trim();
      let matches: ChatHistoryMatch[];
      try {
        matches = await search(trimmed);
      } catch {
        // Settle the pending phase so the chip never dangles, then let the
        // model recover in prose.
        await onResult({ query: trimmed, matches: 0 });
        return "Chat history couldn't be searched right now. Say so plainly and answer from what you have.";
      }

      await onResult({ query: trimmed, matches: matches.length });

      if (matches.length === 0) {
        const retryHint = semantic
          ? "Try once more with a differently-worded description if you haven't already"
          : "Try once more with different, more distinctive keywords if you haven't already";
        return `No past messages match "${trimmed}". ${retryHint}; otherwise tell the user you couldn't find it — never invent a past conversation.`;
      }

      return {
        matches: matches.map((match) => ({
          chatTitle: match.threadTitle,
          ...(match.role !== undefined
            ? { from: match.role === "user" ? "the user" : "you (Whirl)" }
            : {}),
          ...(match.sentAt !== undefined
            ? { date: formatSentAt(match.sentAt) }
            : {}),
          excerpt: match.excerpt,
        })),
        note: "Excerpts are trimmed windows, not full messages. Weave what you found in naturally and mention which chat it came from (title + rough date); quote only what the excerpt actually says.",
      };
    },
  });
}
