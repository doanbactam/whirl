import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";

import {
  getHtmlArtifactRef,
  type LiveHtmlArtifact,
} from "~/components/html/shared";

/**
 * The read-only artifact layer behind a public shared thread. A share renders
 * through the *real* chat UI — the same `MessageBubble`, document/HTML cards and
 * docked side panels as a live thread — but the viewer is usually signed out, so
 * those components can't read each artifact's live row from Convex by id (that
 * needs auth and the viewer's own database). Instead the whole shared payload
 * (every document + visualization) is fetched once, unauthenticated, by
 * `threads:getSharedThread`, and handed to those components through this context.
 *
 * The provider wraps the entire content region — including the docked panels —
 * so "Open" works too. With `shareId` null it's a passthrough: the resolver
 * hooks fall back to the live Convex query and the normal app is untouched.
 */

export const getSharedThreadRef = makeFunctionReference<"query">(
  "threads:getSharedThread",
);
const getDocumentRef = makeFunctionReference<"query">("documents:getDocument");

/** One artifact reference carried by a shared message, in render order. */
export type SharedArtifactRef = {
  kind: "document" | "html";
  refId: string;
  op: "create" | "edit";
  editCount: number | null;
  contentOffset: number | null;
};

export type SharedMessageData = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  artifacts: SharedArtifactRef[];
};

export type SharedDocuments = Record<
  string,
  { title: string; content: string }
>;
export type SharedVisualizations = Record<
  string,
  {
    title: string;
    content: string;
    kind: "inline" | "full";
    /** Public /visual/{shortId} token, when the artifact has one. */
    shortId?: string | null;
  }
>;

export type SharedThread = {
  title: string;
  messages: SharedMessageData[];
  documents: SharedDocuments;
  visualizations: SharedVisualizations;
};

type SharedArtifactStore = {
  documents: SharedDocuments;
  visualizations: SharedVisualizations;
};

const SharedArtifactsContext = createContext<SharedArtifactStore | null>(null);

/** Subscribe to a public shared thread by its token; skips the query when null. */
export function useSharedThread(
  shareId: string | null,
): SharedThread | null | undefined {
  return useQuery(getSharedThreadRef, shareId ? { shareId } : "skip") as
    | SharedThread
    | null
    | undefined;
}

export function SharedArtifactsProvider({
  shareId,
  children,
}: {
  shareId: string | null;
  children: ReactNode;
}) {
  const thread = useSharedThread(shareId);
  const store = useMemo<SharedArtifactStore | null>(
    () =>
      thread
        ? { documents: thread.documents, visualizations: thread.visualizations }
        : null,
    [thread],
  );
  return (
    <SharedArtifactsContext.Provider value={store}>
      {children}
    </SharedArtifactsContext.Provider>
  );
}

/** True inside a loaded shared (read-only, unauthenticated) thread. */
export function useIsSharedArtifacts() {
  return useContext(SharedArtifactsContext) !== null;
}

export type ResolvedDocument = {
  title: string;
  content: string;
  status?: "streaming" | "complete";
};

/**
 * The live `documents` row, or the injected shared copy when on a share page.
 * `enabled` mirrors the card's own gate (it only queries while pending); the
 * shared store ignores it and always resolves, since its content is already
 * loaded. Returns `undefined` while loading, `null` if missing.
 */
export function useLiveDocument(
  documentId: string | undefined,
  enabled = true,
): ResolvedDocument | null | undefined {
  const store = useContext(SharedArtifactsContext);
  const queried = useQuery(
    getDocumentRef,
    !store && enabled && documentId ? { documentId } : "skip",
  ) as ResolvedDocument | null | undefined;
  if (store) {
    if (!documentId) return undefined;
    const doc = store.documents[documentId];
    return doc
      ? { title: doc.title, content: doc.content, status: "complete" }
      : null;
  }
  return queried;
}

/**
 * The live `htmlArtifacts` row, or the injected shared copy when on a share
 * page. Returns `undefined` while loading, `null` if missing.
 */
export function useLiveHtmlArtifact(
  htmlId: string | undefined,
): LiveHtmlArtifact | null | undefined {
  const store = useContext(SharedArtifactsContext);
  const queried = useQuery(
    getHtmlArtifactRef,
    !store && htmlId ? { htmlId } : "skip",
  ) as LiveHtmlArtifact | null | undefined;
  if (store) {
    if (!htmlId) return undefined;
    const viz = store.visualizations[htmlId];
    return viz
      ? {
          kind: viz.kind,
          title: viz.title,
          content: viz.content,
          status: "complete",
          shortId: viz.shortId ?? undefined,
        }
      : null;
  }
  return queried;
}
