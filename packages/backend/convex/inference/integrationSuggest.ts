import { jsonSchema, tool } from "ai";

/** One store match, as the search query returns it to the stream. */
export type IntegrationSuggestion = {
  integrationId: string;
  name: string;
  description?: string;
  author?: string;
  verified: boolean;
  authMode: "none" | "oauth" | "apiKey";
  /** OAuth or Composio-connect listings pop a sign-in during install. */
  needsSignIn: boolean;
  /** The user already has this one — never re-suggested on a card. */
  installed: boolean;
};

/** What lands on the message's integrationSuggestion phase. */
export type IntegrationSuggestionPhasePayload = {
  query: string;
  items: { integrationId: string; name: string }[];
  /**
   * Which half of the flow settled the phase. "searched" is the model looking
   * at candidates with nothing on screen yet — a normal step, not a store
   * miss, and the analytics has to be able to tell those apart.
   */
  stage: "searched" | "shown" | "none";
};

/** How a listing connects, in one phrase the model can put in a sentence. */
function setupOf(match: IntegrationSuggestion): string {
  return match.authMode === "apiKey"
    ? "needs an API key"
    : match.needsSignIn
      ? "sign in to connect"
      : "one-click install";
}

/**
 * The model's window into the integration store.
 *
 * Two steps on purpose. Searching returns candidates as text, to the model
 * only; carding one takes its id. Everything that matched used to be dealt
 * onto the screen at once, which read as a directory dump — four half-right
 * options for a question with one answer, and no sign anyone had chosen. The
 * model knows which one fits the conversation. Now it has to say so, and the
 * user sees exactly that one.
 */
export function createSuggestIntegrationsTool({
  search,
  onResult,
}: {
  search: (query: string) => Promise<IntegrationSuggestion[]>;
  onResult: (payload: IntegrationSuggestionPhasePayload) => Promise<void>;
}) {
  return tool({
    description:
      "Search the integration store, then show ONE install card for the listing that fits. Call it once with `query` to see what's available, then again with `integrationId` to show the one you picked.",
    inputSchema: jsonSchema<{ query: string; integrationId?: string }>({
      type: "object",
      properties: {
        query: {
          type: "string",
          maxLength: 120,
          description: "App name or short capability.",
        },
        integrationId: {
          type: "string",
          description:
            "The id of the single listing to show the user, from a previous search. Omit to search first.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    }),
    execute: async ({ query, integrationId }) => {
      const trimmed = query.trim();
      let matches: IntegrationSuggestion[];
      try {
        matches = await search(trimmed);
      } catch {
        // Settle the pending phase (empty items => it gets dropped) so the
        // chip never dangles, then let the model recover in prose.
        await onResult({ query: trimmed, items: [], stage: "none" });
        return "The integration store couldn't be searched right now. Say so plainly and move on.";
      }

      const installable = matches.filter((m) => !m.installed);
      const alreadyInstalled = matches.filter((m) => m.installed);

      /* --- step two: card the one the model chose --- */
      if (integrationId) {
        const picked = matches.find((m) => m.integrationId === integrationId);
        if (!picked) {
          await onResult({ query: trimmed, items: [], stage: "none" });
          return {
            error: `No listing with id "${integrationId}" matches "${trimmed}".`,
            note: "Nothing was shown. Search again and pick an id from those results.",
          };
        }
        if (picked.installed) {
          await onResult({ query: trimmed, items: [], stage: "none" });
          return {
            alreadyConnected: picked.name,
            note: `${picked.name} is already connected, so no card was shown. Just use it.`,
          };
        }

        await onResult({
          query: trimmed,
          items: [{ integrationId: picked.integrationId, name: picked.name }],
          stage: "shown",
        });
        return {
          shown: {
            name: picked.name,
            ...(picked.description ? { description: picked.description } : {}),
            verified: picked.verified,
            setup: setupOf(picked),
          },
          note: "The user sees one install card for it right where you called this. Reference it in a short line — it already shows the name, description and an install button — and don't repeat those details, add links, or offer the alternatives.",
        };
      }

      /* --- step one: hand the shelf back, show nothing yet --- */
      if (matches.length === 0) {
        await onResult({ query: trimmed, items: [], stage: "none" });
        return `No integrations in the store match "${trimmed}". Tell the user nothing fits yet — don't invent alternatives from memory.`;
      }
      if (installable.length === 0) {
        await onResult({ query: trimmed, items: [], stage: "none" });
        return {
          alreadyConnected: alreadyInstalled.map((m) => m.name),
          note: "Everything matching is already connected. Nothing was shown — just use the connected integration.",
        };
      }

      // The search step shows nothing, so its pending phase is dropped rather
      // than left hanging; the pick that follows opens its own.
      await onResult({ query: trimmed, items: [], stage: "searched" });
      return {
        candidates: installable.map((m) => ({
          integrationId: m.integrationId,
          name: m.name,
          ...(m.description ? { description: m.description } : {}),
          ...(m.author ? { author: m.author } : {}),
          verified: m.verified,
          setup: setupOf(m),
        })),
        ...(alreadyInstalled.length > 0
          ? { alreadyConnected: alreadyInstalled.map((m) => m.name) }
          : {}),
        note: "Nothing is on screen yet. Pick the ONE that best fits what the user actually asked for and call this again with the same query plus its integrationId. If none of them fit, don't call again — say so in prose.",
      };
    },
  });
}
