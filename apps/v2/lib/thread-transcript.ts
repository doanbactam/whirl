import { documentPath, visualPath } from "@/lib/share";

/* Serializes a shared thread into one copy-paste-able markdown document —
   the raw transcript behind /share/{shareId}/raw. Prose rides verbatim,
   artifact cards become blocks woven in at the spot they appeared in the
   turn (contentOffset), visuals ride as public /visual links, and
   generated images as plain markdown images. */

export type SharedArtifactRef = {
  kind: "document" | "html";
  refId: string;
  op: "create" | "edit";
  editCount: number | null;
  contentOffset: number | null;
};

/** What getSharedThread answers with — shared by the viewer page and the
 * transcript page, which render the same payload two ways. */
export type SharedThreadPayload = {
  title: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: number;
    artifacts: SharedArtifactRef[];
    images: string[];
  }>;
  documents: Record<
    string,
    {
      title: string;
      content: string;
      format: "markdown" | "code";
      fileName: string | null;
      language: string | null;
      shortId: string | null;
    }
  >;
  visualizations: Record<
    string,
    {
      title: string;
      content: string;
      kind: "inline" | "full";
      runtime: "html" | "react";
      shortId: string | null;
      /** Withheld from this share because it reads the owner's live
       *  integration data; `content` is empty and there's no public link. */
      dataLocked: boolean;
    }
  >;
};

/** Fence code with more backticks than any run inside it, so a file that
 * itself contains fences can't break out of the block. */
function fenceCode(content: string, language: string): string {
  const longestRun = (content.match(/`+/g) ?? []).reduce(
    (max, run) => Math.max(max, run.length),
    0,
  );
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}

function editSuffix(editCount: number | null): string {
  if (!editCount) return "";
  return ` · ${editCount} change${editCount === 1 ? "" : "s"}`;
}

function artifactBlock(
  thread: SharedThreadPayload,
  ref: SharedArtifactRef,
  origin: string,
): string | null {
  if (ref.kind === "document") {
    const doc = thread.documents[ref.refId];
    if (!doc) return null;
    const link = doc.shortId
      ? ` — [open](${origin}${documentPath(doc.shortId)})`
      : "";
    if (ref.op === "edit") {
      return `*Updated document "${doc.title}"${editSuffix(ref.editCount)}*${link}`;
    }
    if (doc.format === "code") {
      const name = doc.fileName?.trim() || doc.title;
      return `**File: ${name}**${link}\n\n${fenceCode(doc.content, doc.language ?? "")}`;
    }
    return `**Document: ${doc.title}**${link}\n\n${doc.content.trim()}`;
  }

  const visual = thread.visualizations[ref.refId];
  if (!visual) return null;
  /* A locked artifact has no body and no link to offer — the transcript says
     it existed and why it isn't here, rather than pointing at nothing. */
  if (visual.dataLocked) {
    return `*"${visual.title}" isn't included — it reads live data from connected apps.*`;
  }
  const label =
    visual.runtime === "react"
      ? "App"
      : visual.kind === "full"
        ? "Page"
        : "Visual";
  const link = visual.shortId
    ? ` — [view](${origin}${visualPath(visual.shortId)})`
    : "";
  if (ref.op === "edit") {
    return `*Updated ${label.toLowerCase()} "${visual.title}"${editSuffix(ref.editCount)}*${link}`;
  }
  return `**${label}: ${visual.title}**${link}`;
}

/** Interleave artifact blocks into the prose at their recorded character
 * offsets; blocks without one (or past the end) trail the message. */
function weave(
  content: string,
  blocks: Array<{ offset: number | null; text: string }>,
): string {
  const inline = blocks
    .filter(
      (block) => block.offset !== null && block.offset <= content.length,
    )
    .sort((a, b) => a.offset! - b.offset!);
  const trailing = blocks.filter((block) => !inline.includes(block));

  const parts: string[] = [];
  let cursor = 0;
  for (const block of inline) {
    const before = content.slice(cursor, block.offset!).trim();
    if (before) parts.push(before);
    parts.push(block.text);
    cursor = block.offset!;
  }
  const rest = content.slice(cursor).trim();
  if (rest) parts.push(rest);
  for (const block of trailing) parts.push(block.text);
  return parts.join("\n\n");
}

export function buildThreadTranscript(
  thread: SharedThreadPayload,
  options?: { origin?: string },
): string {
  /* Links come out absolute: the browser pages pass nothing and ride
     their own origin, the raw.md route (fetched by terminal agents with
     no base URL to resolve against) passes the request's. */
  const origin =
    options?.origin ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const parts: string[] = [`# ${thread.title}`];

  for (const message of thread.messages) {
    parts.push(message.role === "user" ? "## User" : "## Whirl");

    const blocks = message.artifacts
      .map((ref) => ({
        offset: ref.contentOffset,
        text: artifactBlock(thread, ref, origin),
      }))
      .filter((block): block is { offset: number | null; text: string } =>
        Boolean(block.text),
      );

    let body = weave(message.content?.trim() ?? "", blocks);
    const imageUrls = message.images ?? [];
    if (imageUrls.length > 0) {
      const images = imageUrls
        .map((url) => `![Generated image](${url})`)
        .join("\n\n");
      body = body ? `${body}\n\n${images}` : images;
    }
    if (body) parts.push(body);
  }

  return `${parts.join("\n\n")}\n`;
}
