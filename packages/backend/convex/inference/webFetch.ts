import { jsonSchema, tool } from "ai";

import type { SearchSource } from "./search";

export type ExaContentResult = {
  id?: string;
  url?: string;
  title?: string;
  author?: string;
  publishedDate?: string;
  text?: string;
};

export type ExaContentsResponse = {
  results?: ExaContentResult[];
  statuses?: Array<{
    id: string;
    status: "success" | "error";
    error?: {
      tag?: string;
      httpStatusCode?: number | null;
    };
  }>;
  costDollars?: {
    total?: number;
  };
};

export type FetchPage = {
  url: string;
  title: string;
  text: string;
  author?: string;
  publishedDate?: string;
  error?: string;
};

const MAX_URLS = 5;
const MAX_TEXT_CHARS = 12_000;

function truncateText(text: string) {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n\n[Content truncated due to length.]`;
}

function statusErrorMessage(status: NonNullable<ExaContentsResponse["statuses"]>[number]) {
  if (status.error?.tag) return status.error.tag;
  if (status.error?.httpStatusCode) {
    return `HTTP ${status.error.httpStatusCode}`;
  }
  return "Could not fetch page";
}

export function createWebFetchTool({
  apiKey,
  onFetch,
}: {
  apiKey: string;
  onFetch: (result: {
    sources: number;
    items: SearchSource[];
    costDollars: number;
    callIdx: number;
  }) => Promise<void>;
}) {
  let callIndex = 0;
  return tool({
    description: "Fetch readable text from up to five exact web URLs.",
    inputSchema: jsonSchema<{ urls: string[] }>({
      type: "object",
      properties: {
        urls: {
          type: "array",
          minItems: 1,
          maxItems: MAX_URLS,
          items: {
            type: "string",
            minLength: 1,
            description: "A full https:// URL.",
          },
          description: "URLs to read.",
        },
      },
      required: ["urls"],
      additionalProperties: false,
    }),
    execute: async ({ urls }) => {
      const callIdx = callIndex++;
      const requested = urls.slice(0, MAX_URLS);

      const response = await fetch("https://api.exa.ai/contents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          urls: requested,
          text: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Exa Contents request failed (${response.status}): ${errorText}`,
        );
      }

      const data = (await response.json()) as ExaContentsResponse;

      const resultByUrl = new Map<string, ExaContentResult>();
      for (const result of data.results ?? []) {
        const url = result.url ?? result.id;
        if (url) resultByUrl.set(url, result);
      }

      const pages: FetchPage[] = requested.map((url) => {
        const status = (data.statuses ?? []).find((entry) => entry.id === url);
        if (status?.status === "error") {
          return {
            url,
            title: url,
            text: "",
            error: statusErrorMessage(status),
          };
        }

        const result = resultByUrl.get(url);
        if (!result) {
          return {
            url,
            title: url,
            text: "",
            error: "Page content unavailable",
          };
        }

        return {
          url,
          title: result.title ?? url,
          text: truncateText(result.text ?? ""),
          ...(result.author ? { author: result.author } : {}),
          ...(result.publishedDate
            ? { publishedDate: result.publishedDate }
            : {}),
        };
      });

      const items: SearchSource[] = pages
        .filter((page) => !page.error)
        .map((page) => ({
          url: page.url,
          title: page.title,
          ...(page.author ? { author: page.author } : {}),
          ...(page.publishedDate ? { publishedDate: page.publishedDate } : {}),
        }));

      await onFetch({
        sources: items.length,
        items,
        costDollars: data.costDollars?.total ?? 0,
        callIdx,
      });

      return { pages };
    },
  });
}
