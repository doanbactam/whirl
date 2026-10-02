"use node";

import { ConvexError, v } from "convex/values";
import {
  formatFromBytes,
  formatFromExtension,
  toMarkdownBytes,
  type ConvertErrorCode,
  type Format,
} from "@firecrawl/anydoc";

import { action } from "./_generated/server";

/* Attached documents, turned into Markdown.
 *
 * Word, PowerPoint, Excel, OpenDocument, RTF, EPUB and PDF all reach the model
 * as text — no provider reads the raw containers, and the ones that accept a
 * file block still choke on everything that isn't a PDF. v2 used to do this
 * conversion in the browser: mammoth for .docx, hand-written OOXML/OpenDocument
 * XML walkers, an RTF state machine, pdfjs behind a web worker. Roughly six
 * hundred lines that only ever produced flat prose, and only for the formats
 * somebody had gotten around to writing a parser for.
 *
 * anydoc is one Rust parser per format rendering through a single Markdown
 * serializer, so headings stay headings, tables stay tables, and a spreadsheet
 * arrives as a GFM table instead of tab-separated soup. It also reads the
 * legacy binaries (.doc, .ppt, .xls) that used to come back "save it as .docx",
 * and EPUB, which v2 could not read at all.
 *
 * It is a native addon, which is why this is the one place in the backend that
 * runs in Node rather than Convex's V8 isolate (see `node.externalPackages` in
 * convex.json). Converting here rather than over HTTP from the client is what
 * the storage id buys us: the bytes are already sitting in Convex, so nothing
 * gets uploaded twice and nothing has to squeeze through a request body limit.
 */

/** What comes back for one attachment. Mirrors v2's `DocumentExtraction`. */
export type DocumentMarkdown =
  /** Converted. `text` is GitHub-Flavored Markdown. */
  | { kind: "text"; text: string }
  /** Nothing to read, but the file itself is worth sending: a scanned PDF
   *  rides on as a native file block for models with vision. */
  | { kind: "passthrough" }
  /** Unreadable, with a sentence saying why. The attachment still sends; the
   *  model is told the text couldn't be had. */
  | { kind: "skipped"; reason: string };

/* Matches MAX_FILE_BYTES in apps/v2/lib/attachments.ts. The composer stops
   anything larger long before here; this is the backstop. */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/* A message row has to stay under Convex's document limit and the Markdown
   rides inside it, so a very long document arrives truncated rather than not
   at all. Same ceiling the browser loaders used. */
const MAX_MARKDOWN_CHARS = 200_000;

/* A PDF with no text layer converts to nothing at all. Scanned pages come back
   as `unsupported`, but a cover sheet with three words of metadata converts
   "successfully" into a few useless characters — both should ride on as the
   original file instead of a text block that says nothing. */
const MIN_PDF_MARKDOWN_CHARS = 20;

function extensionOf(name: string): string {
  return name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? "") : "";
}

/** Whatever anydoc rejected with, as a sentence for the person who attached
 *  the file. `io` never happens here — that one is `toMarkdown` reading a
 *  path, and we hand over bytes. */
function describeFailure(code: ConvertErrorCode | undefined): string {
  switch (code) {
    case "encrypted":
      return "This document is password-protected, so its text couldn't be read.";
    case "malformed":
      return "This document is damaged, so its text couldn't be read.";
    case "missingPart":
      return "This document is missing the part that holds its content.";
    case "resourceLimit":
      return "This document is too deeply nested to read safely.";
    case "unsupported":
      return "This file isn't a document format whirl can read.";
    default:
      return "This document couldn't be read.";
  }
}

function errorCodeOf(error: unknown): ConvertErrorCode | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? (code as ConvertErrorCode) : undefined;
}

function clamp(markdown: string): string {
  if (markdown.length <= MAX_MARKDOWN_CHARS) return markdown;
  return `${markdown.slice(0, MAX_MARKDOWN_CHARS)}\n\n...[truncated - document was too long to include in full]`;
}

/**
 * Read an uploaded document out of storage and hand back its Markdown.
 *
 * Only a missing sign-in throws. Everything else — an unknown format, a
 * password, a scan with no text layer — comes back as a result the composer
 * can show on the chip and the model can be told about, because the file has
 * already been uploaded and the turn should still be sendable.
 */
export const convert = action({
  args: {
    storageId: v.id("_storage"),
    /** The original file name. Only the extension is used, and only as the
     *  fallback for a container the content signature doesn't identify. */
    name: v.string(),
  },
  handler: async (ctx, { storageId, name }): Promise<DocumentMarkdown> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const blob = await ctx.storage.get(storageId);
    if (!blob) {
      return {
        kind: "skipped",
        reason: "This document couldn't be found after upload.",
      };
    }
    if (blob.size === 0) {
      return { kind: "skipped", reason: "This document came through empty." };
    }
    if (blob.size > MAX_DOCUMENT_BYTES) {
      return {
        kind: "skipped",
        reason: "This document is too large to read.",
      };
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    /* Content first, extension second: the signature is what a format's own
       specification designates, and a .docx someone renamed to .txt still
       reads as a .docx. `format` stays a plain string so it can be compared —
       anydoc types it as a const enum. */
    const format: string | null =
      formatFromBytes(bytes) ?? formatFromExtension(extensionOf(name));
    const isPdf = format === "pdf";

    let markdown: string;
    try {
      markdown = await toMarkdownBytes(bytes, format as Format | null);
    } catch (error) {
      const code = errorCodeOf(error);
      /* An image-only PDF is `unsupported` — there is no text in it to find.
         The bytes are still worth sending: a model with vision reads the pages
         themselves. Everything else is a dead end worth explaining. */
      if (isPdf && code === "unsupported") return { kind: "passthrough" };
      console.warn(
        `Could not convert ${name} (${format ?? "unknown format"}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { kind: "skipped", reason: describeFailure(code) };
    }

    const text = markdown.trim();
    if (isPdf && text.replace(/\s/g, "").length < MIN_PDF_MARKDOWN_CHARS) {
      return { kind: "passthrough" };
    }
    if (!text) {
      return { kind: "skipped", reason: "This document appears to be empty." };
    }

    return { kind: "text", text: clamp(text) };
  },
});
