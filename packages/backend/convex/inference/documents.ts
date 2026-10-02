import { jsonSchema, tool } from "ai";

import type { Id } from "../_generated/dataModel";

const MAX_TITLE_LENGTH = 120;
const MAX_CONTENT_LENGTH = 200_000;
const MAX_EDITS_PER_CALL = 30;
const MAX_FILE_NAME_LENGTH = 180;
const MAX_LANGUAGE_LENGTH = 40;

export type DocumentFormat = "markdown" | "code";

/** What gets persisted onto the assistant message's `document` phase. */
export type DocumentPhasePayload = {
  op: "create" | "edit";
  documentId: Id<"documents">;
  title?: string;
  editCount?: number;
  ok?: boolean;
  error?: string;
};

/** The result of applying one round of find/replace edits to a document. */
export type ApplyEditsResult = {
  ok: boolean;
  applied: number;
  failed: { find: string; reason: string }[];
  title: string;
  content: string;
};

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  bash: "sh",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  css: "css",
  csv: "csv",
  go: "go",
  html: "html",
  ini: "ini",
  java: "java",
  javascript: "js",
  json: "json",
  jsx: "jsx",
  kotlin: "kt",
  markdown: "md",
  php: "php",
  python: "py",
  ruby: "rb",
  rust: "rs",
  sql: "sql",
  svg: "svg",
  swift: "swift",
  text: "txt",
  toml: "toml",
  tsv: "tsv",
  typescript: "ts",
  tsx: "tsx",
  xml: "xml",
  yaml: "yaml",
};

export function sanitizeCodeFileName(fileName: string, language: string) {
  const baseName = fileName
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f<>:"|?*]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH);
  if (baseName) return baseName;
  const extension = LANGUAGE_EXTENSIONS[language.toLowerCase()] ?? "txt";
  return `untitled.${extension}`;
}

const JSON_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  '"': '"',
  "\\": "\\",
  "/": "/",
};

/**
 * Decode a string field out of *partial* tool-call JSON, mid-stream. Finds the
 * `"<field>":"` key, then walks the string value character by character,
 * stopping at the first unescaped closing quote (field complete) or at the end
 * of what's arrived so far (still streaming). Undefined until the field's
 * opening quote shows up.
 */
function scanStringField(
  raw: string,
  field: string,
): { value: string; complete: boolean } | undefined {
  const opener = new RegExp(`"${field}"\\s*:\\s*"`);
  const match = opener.exec(raw);
  if (!match) return undefined;

  let i = match.index + match[0].length;
  let out = "";
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "\\") {
      const next = raw[i + 1];
      if (next === undefined) break; // escape split across chunks — stop here
      if (next === "u") {
        if (i + 6 > raw.length) break; // incomplete \uXXXX — wait for the rest
        const code = parseInt(raw.slice(i + 2, i + 6), 16);
        out += Number.isNaN(code) ? "" : String.fromCharCode(code);
        i += 6;
        continue;
      }
      out += JSON_ESCAPES[next] ?? next;
      i += 2;
      continue;
    }
    if (ch === '"') return { value: out, complete: true };
    out += ch;
    i += 1;
  }
  return { value: out, complete: false };
}

/**
 * The createDocument body streams in as the JSON argument
 * `{"title":…,"content":…}`, and we want to surface `content` into the live
 * document row before the closing quote has even arrived — so this returns
 * however much of the field's value exists so far.
 */
export function extractStreamingField(
  raw: string,
  field: string,
): string | undefined {
  return scanStringField(raw, field)?.value;
}

/**
 * Like extractStreamingField, but only once the whole value has arrived (its
 * closing quote is in). For fields that are useless half-typed — an
 * integration's name mid-word matches nothing in the store.
 */
export function extractCompleteField(
  raw: string,
  field: string,
): string | undefined {
  const scanned = scanStringField(raw, field);
  return scanned?.complete ? scanned.value : undefined;
}

/**
 * Lets whirl spin up a markdown document — a standalone artifact the user can
 * open, read, and keep editing in the document panel — instead of dumping a long
 * piece of writing into the chat. The body streams live into a card + side panel
 * as whirl writes it; `finalize` closes out the row the stream loop opened (and
 * is the one place a row is created if the provider didn't stream the input).
 * The returned `documentId` is how whirl targets the doc for later edits.
 */
export function createDocumentTool({
  finalize,
  onResult,
}: {
  finalize: (args: {
    toolCallId: string;
    title: string;
    content: string;
    format: DocumentFormat;
    fileName?: string;
    language?: string;
  }) => Promise<{ documentId: Id<"documents"> }>;
  onResult: (payload: DocumentPhasePayload) => Promise<void>;
}) {
  return tool({
    description: "Create a keepable markdown document in the side panel.",
    inputSchema: jsonSchema<{ title: string; content: string }>({
      type: "object",
      properties: {
        title: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TITLE_LENGTH,
          description: "Short document title.",
        },
        content: {
          type: "string",
          minLength: 1,
          maxLength: MAX_CONTENT_LENGTH,
          description: "Full unfenced GitHub-flavored Markdown body. Put last.",
        },
      },
      required: ["title", "content"],
      additionalProperties: false,
    }),
    execute: async ({ title, content }, { toolCallId }) => {
      const cleanTitle = title.trim().slice(0, MAX_TITLE_LENGTH) || "Untitled";
      const { documentId } = await finalize({
        toolCallId,
        title: cleanTitle,
        content,
        format: "markdown",
      });
      await onResult({ op: "create", documentId, title: cleanTitle });
      return {
        documentId,
        title: cleanTitle,
        ok: true,
        note: "Document created and shown to the user in a side panel. Use editDocument with this documentId to revise it.",
      };
    },
  });
}

/**
 * Create a standalone source file in the document panel. The content is raw
 * code (never fenced Markdown), so it can be edited in place and downloaded
 * byte-for-byte under the requested filename.
 */
export function createCodeDocumentTool({
  finalize,
  onResult,
}: {
  finalize: (args: {
    toolCallId: string;
    title: string;
    content: string;
    format: DocumentFormat;
    fileName?: string;
    language?: string;
  }) => Promise<{ documentId: Id<"documents"> }>;
  onResult: (payload: DocumentPhasePayload) => Promise<void>;
}) {
  return tool({
    description:
      "Create a keepable, editable text file of any type — code, config, data (CSV, JSON, YAML), or SVG — in the side panel.",
    inputSchema: jsonSchema<{
      title: string;
      fileName: string;
      language: string;
      content: string;
    }>({
      type: "object",
      properties: {
        title: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TITLE_LENGTH,
          description: "Short human-readable title.",
        },
        fileName: {
          type: "string",
          minLength: 1,
          maxLength: MAX_FILE_NAME_LENGTH,
          description: "Download filename including the correct extension.",
        },
        language: {
          type: "string",
          minLength: 1,
          maxLength: MAX_LANGUAGE_LENGTH,
          description: "Lowercase programming language or file format.",
        },
        content: {
          type: "string",
          minLength: 1,
          maxLength: MAX_CONTENT_LENGTH,
          description: "Complete raw file contents without Markdown fences. Put last.",
        },
      },
      required: ["title", "fileName", "language", "content"],
      additionalProperties: false,
    }),
    execute: async (
      { title, fileName, language, content },
      { toolCallId },
    ) => {
      const cleanTitle = title.trim().slice(0, MAX_TITLE_LENGTH) || "Untitled";
      const cleanLanguage =
        language.trim().toLowerCase().slice(0, MAX_LANGUAGE_LENGTH) || "text";
      const cleanFileName = sanitizeCodeFileName(fileName, cleanLanguage);
      const { documentId } = await finalize({
        toolCallId,
        title: cleanTitle,
        content,
        format: "code",
        fileName: cleanFileName,
        language: cleanLanguage,
      });
      await onResult({ op: "create", documentId, title: cleanTitle });
      return {
        documentId,
        title: cleanTitle,
        fileName: cleanFileName,
        language: cleanLanguage,
        ok: true,
        note: "Code document created and shown to the user. Use editDocument with this documentId to revise it.",
      };
    },
  });
}

/**
 * Lets whirl revise an existing document with targeted find/replace edits, so
 * only the changed regions update and untouched text is preserved exactly. Each
 * `find` must match the current document text exactly and appear only once. The
 * model is given the document's current content in its prompt, so it can copy
 * anchors verbatim; any miss is reported back with the current content so it can
 * re-anchor on a retry.
 */
export function createEditDocumentTool({
  applyEdits,
  onResult,
  onNoChange,
}: {
  applyEdits: (args: {
    documentId: Id<"documents">;
    edits: { find: string; replace: string }[];
  }) => Promise<ApplyEditsResult>;
  onResult: (payload: DocumentPhasePayload) => Promise<void>;
  /** Called when an edit landed nothing, so the pending card is dropped (no
   * failure shown in chat) while the model still gets the misses to retry. */
  onNoChange: () => Promise<void>;
}) {
  return tool({
    description:
      "Edit an existing document with exact, unique current-text replacements.",
    inputSchema: jsonSchema<{
      documentId: string;
      edits: { find: string; replace: string }[];
    }>({
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Document id.",
        },
        edits: {
          type: "array",
          minItems: 1,
          maxItems: MAX_EDITS_PER_CALL,
          description: "Ordered replacements.",
          items: {
            type: "object",
            properties: {
              find: {
                type: "string",
                minLength: 1,
                description: "Exact unique current-text substring.",
              },
              replace: {
                type: "string",
                description: "Replacement; empty deletes.",
              },
            },
            required: ["find", "replace"],
            additionalProperties: false,
          },
        },
      },
      required: ["documentId", "edits"],
      additionalProperties: false,
    }),
    execute: async ({ documentId, edits }) => {
      const id = documentId as Id<"documents">;
      const result = await applyEdits({
        documentId: id,
        edits: edits.slice(0, MAX_EDITS_PER_CALL),
      });
      // A card shows only when something actually changed. A full miss drops the
      // pending card entirely (no failure surfaced to the user); a partial apply
      // shows as a success ("updated · N changes"). Either way the model gets the
      // misses + current content below so it can re-anchor and retry silently.
      if (result.applied > 0) {
        await onResult({
          op: "edit",
          documentId: id,
          title: result.title,
          editCount: result.applied,
          ok: true,
        });
      } else {
        await onNoChange();
      }
      return {
        applied: result.applied,
        ok: result.ok,
        ...(result.failed.length > 0
          ? { failed: result.failed, currentContent: result.content }
          : {}),
      };
    },
  });
}
