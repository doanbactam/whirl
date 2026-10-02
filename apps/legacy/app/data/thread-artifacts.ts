import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";

/** A whirl-authored markdown document in the thread (toolbar menu entry). */
export type ThreadDocument = {
  id: string;
  title: string;
  updatedAt: number;
};

/** A whirl-authored HTML visualization in the thread (toolbar menu entry). */
export type ThreadVisualization = {
  id: string;
  title: string;
  kind: "inline" | "full";
  shortId: string | null;
  updatedAt: number;
};

export type ThreadArtifacts = {
  documents: ThreadDocument[];
  visualizations: ThreadVisualization[];
};

const getThreadArtifactsRef = makeFunctionReference<"query">(
  "threads:getThreadArtifacts",
);

const EMPTY: ThreadArtifacts = { documents: [], visualizations: [] };

/**
 * The documents + visualizations whirl authored in a thread, for the thread
 * toolbar's artifact menu. Attachments are not included — those ride on the
 * messages already loaded in the chat, so the toolbar reads them from there.
 */
export function useThreadArtifacts(
  threadId: string | undefined,
): ThreadArtifacts {
  const data = useQuery(
    getThreadArtifactsRef,
    threadId ? { threadId } : "skip",
  ) as ThreadArtifacts | undefined;
  return data ?? EMPTY;
}
