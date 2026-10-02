import { sharePath, visualPath } from "~/lib/share";
import type { SharedArtifactRef, SharedThread } from "~/lib/shared-artifacts";

/**
 * Serialize a shared thread into one self-contained markdown document — the
 * raw-content view of a share. Message text and whirl-authored documents are
 * embedded in full; visualizations (which can't live in markdown) become links
 * to their public pages instead. `origin` is passed in because this also runs
 * server-side, where `window` doesn't exist.
 */
export function sharedThreadMarkdown(
  thread: SharedThread,
  shareId: string,
  origin: string,
): string {
  const lines: string[] = [
    `# ${thread.title}`,
    "",
    `> A conversation shared from [Whirl](${origin}${sharePath(shareId)}).`,
  ];

  for (const message of thread.messages) {
    lines.push("", "---", "", `## ${message.role === "user" ? "You" : "Whirl"}`);
    const text = message.content.trim();
    if (text) lines.push("", text);
    for (const artifact of message.artifacts) {
      lines.push("", artifactMarkdown(artifact, thread, shareId, origin));
    }
  }

  return `${lines.join("\n")}\n`;
}

function artifactMarkdown(
  artifact: SharedArtifactRef,
  thread: SharedThread,
  shareId: string,
  origin: string,
): string {
  if (artifact.kind === "html") {
    const viz = thread.visualizations[artifact.refId];
    const title = viz?.title || "Visualization";
    // An HTML page can't be embedded in markdown — link to its public /visual
    // page, falling back to the share page when no standalone token exists.
    const url = viz?.shortId
      ? `${origin}${visualPath(viz.shortId)}`
      : `${origin}${sharePath(shareId)}`;
    const label = artifact.op === "edit" ? "Updated visualization" : "Visualization";
    return `> ${label}: [${title}](${url})`;
  }

  const doc = thread.documents[artifact.refId];
  const title = doc?.title || "Untitled document";
  if (artifact.op === "edit" || !doc) {
    // Revisions re-reference the row whose latest content is already embedded
    // at the create site, so they read as a compact note — like the chat UI.
    return `> Updated document: **${title}**`;
  }
  return [`> Document: **${title}**`, "", doc.content.trim()].join("\n");
}
