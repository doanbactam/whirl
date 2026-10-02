import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import { sharedThreadMarkdown } from "~/lib/share-markdown";
import type { SharedThread } from "~/lib/shared-artifacts";

const getSharedThread = makeFunctionReference<"query">(
  "threads:getSharedThread",
);

// text/plain (not text/markdown) so browsers render the file in the tab
// instead of downloading it.
const PLAIN_TEXT = { "Content-Type": "text/plain; charset=utf-8" };

/**
 * GET /share/{shareId}/raw — the literal markdown of a public shared thread,
 * served as plain text with no app shell around it. Same trimmed payload as
 * the share page: message text and documents in full, visualizations as links.
 */
export const Route = createFileRoute("/share_/$shareId/raw")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const convexUrl = import.meta.env.VITE_CONVEX_URL as
          | string
          | undefined;
        if (!convexUrl) {
          return new Response("Raw view unavailable.", {
            status: 500,
            headers: PLAIN_TEXT,
          });
        }

        const client = new ConvexHttpClient(convexUrl);
        const thread = (await client.query(getSharedThread, {
          shareId: params.shareId,
        })) as SharedThread | null;
        if (!thread) {
          return new Response("This conversation isn't available.", {
            status: 404,
            headers: PLAIN_TEXT,
          });
        }

        const markdown = sharedThreadMarkdown(
          thread,
          params.shareId,
          new URL(request.url).origin,
        );
        return new Response(markdown, { headers: PLAIN_TEXT });
      },
    },
  },
});
