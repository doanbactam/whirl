import { makeFunctionReference } from "convex/server";

/** The live `htmlArtifacts` row, as the card + panel read it (subset of fields). */
export type LiveHtmlArtifact = {
  kind: "inline" | "full";
  title: string;
  content: string;
  status: "streaming" | "pending" | "generating" | "complete" | "failed";
  error?: string;
  /** Public share token (5 chars); powers {site}/visual/{shortId}. */
  shortId?: string;
};

/** What the public share page reads (no auth; completed artifacts only). */
export type SharedArtifact = {
  kind: "inline" | "full";
  title: string;
  content: string;
};

export const getHtmlArtifactRef =
  makeFunctionReference<"query">("html:getHtmlArtifact");

export const getSharedArtifactRef =
  makeFunctionReference<"query">("html:getSharedArtifact");
