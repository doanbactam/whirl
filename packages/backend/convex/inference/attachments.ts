import type { UserContent } from "ai";

import type { Id } from "../_generated/dataModel";

export type AttachmentForPrompt = {
  name: string;
  size: number;
  type: string;
  storageId?: Id<"_storage">;
  url?: string;
  data?: string;
  text?: string;
  skippedReason?: string;
};

export type AttachmentStorage = {
  getUrl(storageId: Id<"_storage">): Promise<string | null>;
  get(storageId: Id<"_storage">): Promise<Blob | null>;
};

const TEXT_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/xml",
  "application/yaml",
  "application/toml",
  "application/sql",
];

// Office formats (.docx/.doc/.pptx/.xlsx/.rtf/.epub…) are only useful to the
// model once converted to Markdown — that conversion happens at upload, in
// convex/attachmentMarkdown.ts. If one reaches here with no extracted text, the
// raw bytes are gibberish to every provider (Gemini answers "the document has
// no pages"), so we omit it with a note rather than send a file block that
// hard-fails the request.
const EXTRACT_ONLY_MIME_PREFIXES = [
  "application/vnd.openxmlformats-officedocument",
  "application/msword",
  "application/vnd.ms-word",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument",
  "application/rtf",
  "text/rtf",
  "application/epub+zip",
];

function needsTextExtraction(type: string) {
  return EXTRACT_ONLY_MIME_PREFIXES.some((prefix) => type.startsWith(prefix));
}
const TEXT_STORAGE_EXTENSIONS = new Set([
  "c",
  "conf",
  "cpp",
  "cs",
  "csv",
  "css",
  "dart",
  "diff",
  "env",
  "go",
  "h",
  "html",
  "htm",
  "ini",
  "java",
  "js",
  "json",
  "jsonc",
  "jsx",
  "kt",
  "kts",
  "log",
  "lua",
  "md",
  "mdx",
  "patch",
  "php",
  "py",
  "r",
  "rb",
  "rs",
  "scala",
  "sh",
  "sql",
  "srt",
  "svelte",
  // SVG is markup: read it out of storage as source rather than shipping an
  // image block no provider decodes. Covers attachments sent before the
  // client stopped typing them image/svg+xml, too.
  "svg",
  "swift",
  "toml",
  "ts",
  "tsx",
  "tsv",
  "txt",
  "vue",
  "vtt",
  "xml",
  "yaml",
  "yml",
]);

function formatAttachmentNote(attachment: AttachmentForPrompt) {
  if (attachment.skippedReason) {
    return `[Attachment omitted: ${attachment.name} (${attachment.type || "unknown type"}, ${attachment.size} bytes). ${attachment.skippedReason}]`;
  }
  if (!attachment.data && !attachment.text && !attachment.url) {
    return `[Attachment unavailable: ${attachment.name} (${attachment.type || "unknown type"}, ${attachment.size} bytes).]`;
  }
  return null;
}

/**
 * Wrap an attachment's inline text in explicit begin/end fences that repeat the
 * file name, so the model reads it as a discrete document it was handed — not as
 * a continuation of the user's prose. The closing fence matters as much as the
 * opening one: without it the model can't tell where the file stops and the rest
 * of the turn resumes. The hosted URL rides in the descriptor so the model can
 * link or reference the file itself (e.g. in an HTML artifact) when asked.
 */
function wrapAttachmentText(attachment: AttachmentForPrompt) {
  const descriptor = [
    attachment.name,
    attachment.type || null,
    `${attachment.size} bytes`,
    attachment.url ? `hosted at ${attachment.url}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return [
    `===== BEGIN ATTACHMENT: ${descriptor} =====`,
    attachment.text,
    `===== END ATTACHMENT: ${attachment.name} =====`,
  ].join("\n");
}

function isTextMime(type: string, name: string) {
  if (TEXT_MIME_PREFIXES.some((prefix) => type.startsWith(prefix))) {
    return true;
  }

  const ext = name.includes(".")
    ? (name.split(".").pop()?.toLowerCase() ?? "")
    : "";
  return TEXT_STORAGE_EXTENSIONS.has(ext);
}

export async function hydrateAttachmentUrls(
  storage: AttachmentStorage,
  attachments: AttachmentForPrompt[] | undefined,
) {
  if (!attachments) {
    return attachments;
  }

  return await Promise.all(
    attachments.map(async (attachment) => {
      if (!attachment.storageId) {
        return attachment;
      }

      const url = await storage.getUrl(attachment.storageId);
      const hydrated = { ...attachment, ...(url ? { url } : {}) };

      if (
        attachment.text === undefined &&
        isTextMime(attachment.type ?? "", attachment.name ?? "")
      ) {
        try {
          const blob = await storage.get(attachment.storageId);
          if (blob) {
            hydrated.text = await blob.text();
          }
        } catch {
          // Fall back to URL-based access.
        }
      }

      return hydrated;
    }),
  );
}

export type AssistantHistoryPhase = {
  kind: string;
  prompt?: string;
  images?: string[];
  server?: string;
  tool?: string;
  ok?: boolean;
  pending?: boolean;
  op?: string;
  title?: string;
  documentId?: string;
  htmlId?: string;
  questions?: { prompt: string }[];
  answered?: boolean;
};

export type HistoryEventOptions = {
  /**
   * Public share links by artifact id (built in getRequestForStream), so the
   * events for document/html phases carry the link the model can hand the
   * user on later turns.
   */
  shareLinks?: {
    documents: Record<string, string>;
    html: Record<string, string>;
  };
};

/**
 * What whirl's tools did during one assistant turn, as plain lines.
 *
 * These never go back into the assistant message they describe. An
 * image-only or artifact-only turn has no prose, so the note WOULD BE the
 * whole assistant message — and a model reading its own last reply as
 * `[whirl painted an image here: <url>]` writes exactly that on the next
 * turn, inventing a storage URL to fill the slot. getRequestForStream folds
 * these into a labelled system-log block on the following user turn instead,
 * where there is nothing in whirl's voice to copy.
 */
export function assistantHistoryEvents(
  message: {
    content?: string;
    attachments?: AttachmentForPrompt[];
    phases?: AssistantHistoryPhase[];
  },
  options?: HistoryEventOptions,
): string[] {
  // Generated images are recorded as text rather than sent as assistant image
  // parts — providers are inconsistent about image-bearing assistant
  // messages, and a rejection there would break every later turn in the
  // thread. The actual pixels of the most recent one are re-attached to the
  // latest user turn instead (see getRequestForStream), so a text model
  // picked after an image turn can still see what was made.
  const events: string[] = [];
  const generatedImages = (message.attachments ?? []).filter((attachment) =>
    attachment.type?.startsWith("image/"),
  );
  if (generatedImages.length > 0) {
    // URLs included so the model can re-show or link a picture on later
    // turns instead of claiming it can't access what it just made.
    const listed = generatedImages
      .map((attachment) =>
        attachment.url
          ? `${attachment.name} (${attachment.url})`
          : attachment.name,
      )
      .join(", ");
    events.push(
      `whirl generated ${
        generatedImages.length === 1
          ? "an image"
          : `${generatedImages.length} images`
      } in the reply above: ${listed}`,
    );
  }
  // Documents and HTML artifacts made that turn are recorded with their
  // public share link, so "send me the link to that doc" on a later turn has
  // an answer in-context (the system prompt carries them too).
  for (const phase of message.phases ?? []) {
    if (phase.pending) continue;
    if (phase.kind === "document" && phase.documentId) {
      const link = options?.shareLinks?.documents[phase.documentId];
      events.push(
        `whirl ${phase.op === "edit" ? "revised" : "wrote"} a document: "${
          phase.title || "Untitled"
        }" (id: ${phase.documentId}${link ? `, public link: ${link}` : ""})`,
      );
    } else if (phase.kind === "html" && phase.htmlId) {
      const link = options?.shareLinks?.html[phase.htmlId];
      events.push(
        `whirl ${phase.op === "edit" ? "revised" : "built"} an HTML artifact: "${
          phase.title || "Untitled"
        }" (id: ${phase.htmlId}${link ? `, public link: ${link}` : ""})`,
      );
    }
  }
  // Tool paints land on the message's `image` phases (background worker), not
  // in the prose — replay them with their URLs so later turns know what was
  // painted and can re-show a picture as a markdown image if asked.
  for (const phase of message.phases ?? []) {
    if (phase.kind !== "image" || !phase.images?.length) continue;
    events.push(
      `whirl painted an image${
        phase.prompt ? ` (prompt: ${phase.prompt})` : ""
      }; it is already on screen. Stored at: ${phase.images.join(", ")}`,
    );
  }
  // Question forms only exist as phases, so without a record a later turn has
  // no idea what was asked — and the user's next message reads like answers
  // to nothing.
  for (const phase of message.phases ?? []) {
    if (phase.kind !== "question" || phase.pending) continue;
    if (!phase.questions?.length) continue;
    const asked = phase.questions
      .map((question) => `"${question.prompt}"`)
      .join(" · ");
    events.push(
      phase.answered
        ? `whirl asked the user with an interactive form: ${asked} — they answered via the form in their next message.`
        : `whirl asked the user with an interactive form: ${asked} — they replied in their own words instead of the form.`,
    );
  }
  // Tool results are not replayed as provider tool messages on later turns,
  // but the model still needs to know an integration action already ran.
  // Without this note, a terse "continue" after a tool-heavy reply makes it
  // start the same searches from scratch.
  for (const phase of message.phases ?? []) {
    if (phase.kind !== "mcp" || phase.pending) continue;
    const label = [phase.server, phase.tool].filter(Boolean).join(" · ");
    if (!label) continue;
    events.push(
      `Integration action already attempted: ${label} (${phase.ok === false ? "failed" : "succeeded"}). Do not repeat the same action on a follow-up unless the user explicitly asks to retry, refresh, or run it again.`,
    );
  }
  return events;
}

// The envelope is doing the work the old bracket convention couldn't: it says
// what the lines are, whose voice they are not, and — because a fabricated
// storage URL is the failure that actually reached users — that a link only
// exists if it is written out here.
const HISTORY_EVENTS_PREAMBLE =
  "System-generated record of what whirl's tools did in the conversation above. It is not a message, not part of any reply, and not something to respond to. Read it as context only: never quote, restate, reformat, or imitate these lines, and never write a link, id, or file URL that does not appear verbatim inside one of them.";

export function historyEventsBlock(events: string[]) {
  return [
    "<whirl_system_log>",
    HISTORY_EVENTS_PREAMBLE,
    ...events.map((event) => `- ${event}`),
    "</whirl_system_log>",
  ].join("\n");
}

/** Content as parts, so blocks can be prepended to either shape. */
export function toContentParts(
  content: UserContent,
): Exclude<UserContent, string> {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }
  return [...content];
}

/** Prefix a user turn with the tool events from the assistant turns before it. */
export function withHistoryEvents(
  content: UserContent,
  events: string[],
): UserContent {
  if (events.length === 0) return content;
  return [
    { type: "text", text: historyEventsBlock(events) },
    ...toContentParts(content),
  ];
}

export function messageContentForModel(
  message: {
    role: "user" | "assistant";
    content: string;
    attachments?: AttachmentForPrompt[];
  },
  options?: {
    /**
     * Whether the target model accepts raw binary file blocks (PDFs etc.).
     * Tiers without it (see MODEL_ACCEPTS_NATIVE_FILES) read documents as
     * text extracted at upload; a binary with no text — a scanned PDF — is
     * omitted with a note instead of sent as a block the provider rejects.
     */
    nativeFiles?: boolean;
  },
): UserContent {
  const nativeFiles = options?.nativeFiles ?? true;
  // Assistant turns ship as pure prose: everything else that happened in one
  // is hoisted into the next user turn's system log (assistantHistoryEvents).
  if (message.role === "assistant") {
    return message.content;
  }
  if (!message.attachments?.length) {
    return message.content;
  }

  const parts: Exclude<UserContent, string> = [];
  if (message.content.trim()) {
    parts.push({ type: "text", text: message.content });
  }

  // Image tags: the composer lets the user point at an attached picture as
  // @<file name> ("put @sunset.jpg on top of @logo.png"), so each image part
  // is preceded by a label tying that handle to the pixels that follow.
  // Labels are only injected when they can matter — several images, a typed
  // @<name> tag, or a legacy @imgN token from before tags used file names —
  // so the common single-screenshot case stays clean.
  const imageOrdinals = new Map<AttachmentForPrompt, number>();
  for (const attachment of message.attachments) {
    if (attachment.type?.startsWith("image/")) {
      imageOrdinals.set(attachment, imageOrdinals.size + 1);
    }
  }
  const contentLower = message.content.toLowerCase();
  const labelImages =
    imageOrdinals.size > 1 ||
    /@img\d+/i.test(message.content) ||
    [...imageOrdinals.keys()].some((attachment) =>
      contentLower.includes(`@${attachment.name.toLowerCase()}`),
    );

  for (const attachment of message.attachments) {
    const note = formatAttachmentNote(attachment);
    if (note) {
      parts.push({ type: "text", text: note });
      continue;
    }

    if (attachment.text !== undefined) {
      parts.push({
        type: "text",
        text: wrapAttachmentText(attachment),
      });
      continue;
    }

    const mediaType = attachment.type || "application/octet-stream";
    const data = attachment.data ?? attachment.url ?? null;
    if (!data) {
      parts.push({
        type: "text",
        text: `[Attachment unavailable: ${attachment.name} (${mediaType}, ${attachment.size} bytes).]`,
      });
      continue;
    }

    if (mediaType.startsWith("image/")) {
      // The hosted URL rides along so later turns can link or re-show the
      // user's own upload as a markdown image when asked.
      if (labelImages) {
        const ordinal = imageOrdinals.get(attachment);
        parts.push({
          type: "text",
          text: `Image ${ordinal} (the user refers to it as @${attachment.name}${
            attachment.url ? `, hosted at ${attachment.url}` : ""
          }):`,
        });
      } else if (attachment.url) {
        parts.push({
          type: "text",
          text: `[Image attachment "${attachment.name}", hosted at ${attachment.url}:]`,
        });
      }
      parts.push({
        type: "image",
        image: data,
        mediaType,
      });
    } else if (needsTextExtraction(mediaType)) {
      // Got here without extracted text — sending the raw office file would
      // crash the provider, so omit it and tell the model why.
      parts.push({
        type: "text",
        text: `[Attachment omitted: ${attachment.name} (${mediaType}, ${attachment.size} bytes) couldn't be converted to readable text.]`,
      });
    } else if (isTextMime(mediaType, attachment.name)) {
      // Plain-text files must ride inline — never as a native file block.
      // Providers like Google only accept PDFs there, and base64 prose helps
      // nobody. Hydration should have filled `text`; this is the last resort.
      parts.push({
        type: "text",
        text: `[Attachment unavailable: ${attachment.name} (${mediaType}, ${attachment.size} bytes). Text could not be read.]`,
      });
    } else if (!nativeFiles) {
      // A binary with no extracted text on a tier that can't take file
      // blocks — in practice a scanned PDF with no text layer. Omit it with
      // a note so the model can say why instead of the request hard-failing.
      parts.push({
        type: "text",
        text: `[Attachment omitted: ${attachment.name} (${mediaType}, ${attachment.size} bytes). No text could be extracted and the current model can't read raw files — try the Heavy model for scanned documents.]`,
      });
    } else {
      // Natively-readable binaries: PDFs (incl. scanned passthrough), plus the
      // audio/video the bigger tiers accept. The hosted URL rides along as a
      // label so the model can link or reference the file on later turns.
      if (attachment.url) {
        parts.push({
          type: "text",
          text: `[File attachment "${attachment.name}" (${mediaType}), hosted at ${attachment.url}:]`,
        });
      }
      parts.push({
        type: "file",
        data,
        filename: attachment.name,
        mediaType,
      });
    }
  }

  return parts.length > 0 ? parts : message.content;
}
