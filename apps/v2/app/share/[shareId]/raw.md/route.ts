import { ConvexHttpClient } from "convex/browser";
import { api } from "@whirl/backend/convex/_generated/api";

import {
  buildThreadTranscript,
  type SharedThreadPayload,
} from "@/lib/thread-transcript";

/* The machine-readable transcript: plain markdown over HTTP, no page
   shell, no client-side hydration — this is the URL the hand-off commands
   feed to terminal agents, which see exactly what a curl sees. Served as
   text/plain so browsers display it instead of downloading. The share
   token stays the only gate, same as the pretty pages. */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await params;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return new Response("Transcript service is not configured.", {
      status: 500,
    });
  }

  let thread: SharedThreadPayload | null;
  try {
    const client = new ConvexHttpClient(convexUrl);
    thread = (await client.query(api.threads.getSharedThread, {
      shareId,
    })) as SharedThreadPayload | null;
  } catch {
    return new Response("Couldn't load the transcript. Try again shortly.", {
      status: 502,
    });
  }

  if (!thread) {
    return new Response(
      "This conversation isn't available. The link may have been turned off by its owner.",
      { status: 404 },
    );
  }

  const origin = new URL(request.url).origin;
  return new Response(buildThreadTranscript(thread, { origin }), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
