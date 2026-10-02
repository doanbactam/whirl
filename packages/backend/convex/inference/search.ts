import { jsonSchema, tool } from "ai";

export type ExaCitation = {
  id?: string;
  url?: string;
  title?: string;
  author?: string;
  publishedDate?: string;
  text?: string;
};

export type ExaAnswerResponse = {
  answer?: string | Record<string, unknown>;
  citations?: ExaCitation[];
  costDollars?: {
    total?: number;
  };
};

export type SearchSource = {
  url: string;
  title: string;
  author?: string;
  publishedDate?: string;
};

// Exa returns each citation's full page text, and a statute or long article
// runs to megabytes. Every later step of the turn re-sends the whole tool
// result, so one uncapped citation multiplies across the loop: on 2026-09-21
// a single Fable turn climbed to ~1M prompt tokens a step and cost $85. The
// synthesized answer carries the substance; the text is supporting evidence
// and gets the same treatment as fetchUrl's page cap, only tighter.
const MAX_CITATIONS = 8;
const MAX_CITATION_TEXT_CHARS = 2_000;
const MAX_ANSWER_CHARS = 8_000;

function clampText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[Content truncated due to length.]`;
}

export function createExaAnswerTool({
  apiKey,
  onAnswer,
}: {
  apiKey: string;
  onAnswer: (result: {
    sources: number;
    items: SearchSource[];
    costDollars: number;
    callIdx: number;
  }) => Promise<void>;
}) {
  let callIndex = 0;
  return tool({
    description: "Answer a precise question using current web sources.",
    inputSchema: jsonSchema<{ query: string }>({
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description: "The natural-language question.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    }),
    execute: async ({ query }) => {
      const callIdx = callIndex++;

      const response = await fetch("https://api.exa.ai/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          query,
          text: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Exa Answer request failed (${response.status}): ${errorText}`,
        );
      }

      const data = (await response.json()) as ExaAnswerResponse;
      const items = (data.citations ?? [])
        .map((citation) => {
          const url = citation.url ?? citation.id ?? "";
          if (!url) return null;
          return {
            url,
            title: citation.title ?? citation.url ?? citation.id ?? "Untitled",
            ...(citation.author ? { author: citation.author } : {}),
            ...(citation.publishedDate
              ? { publishedDate: citation.publishedDate }
              : {}),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      await onAnswer({
        sources: items.length,
        items,
        costDollars: data.costDollars?.total ?? 0,
        callIdx,
      });

      return {
        answer: clampText(
          typeof data.answer === "string"
            ? data.answer
            : JSON.stringify(data.answer ?? null),
          MAX_ANSWER_CHARS,
        ),
        citations: (data.citations ?? [])
          .slice(0, MAX_CITATIONS)
          .map((citation) => ({
            url: citation.url ?? citation.id ?? "",
            title: citation.title ?? citation.url ?? citation.id ?? "Untitled",
            author: citation.author ?? null,
            publishedDate: citation.publishedDate ?? null,
            text: citation.text
              ? clampText(citation.text, MAX_CITATION_TEXT_CHARS)
              : null,
          })),
      };
    },
  });
}
