import { jsonSchema, tool } from "ai";

import type { Id } from "../_generated/dataModel";
import { FULL_PAGE_DESIGN_NOTES } from "./designTasteSkill";
import { HTML_THEME_REFERENCE } from "./htmlTheme";

const MAX_TITLE_LENGTH = 120;
const MAX_HTML_LENGTH = 400_000;
const MAX_EDITS_PER_CALL = 30;

/** What gets persisted onto the assistant message's `html` phase. */
export type HtmlPhasePayload = {
  op: "create" | "edit";
  mode: "inline" | "full";
  htmlId: Id<"htmlArtifacts">;
  title?: string;
  editCount?: number;
  ok?: boolean;
  error?: string;
};

/** The result of applying one round of find/replace edits to an artifact. */
export type ApplyHtmlEditsResult = {
  ok: boolean;
  applied: number;
  failed: { find: string; reason: string }[];
  title: string;
  content: string;
  kind: "inline" | "full";
};

/**
 * Lets whirl render a small, self-contained HTML visualization straight into
 * the chat — a diagram, chart, timeline, interactive demo, anything that's
 * clearer shown than told. The body streams live into an inline card (inside a
 * sandboxed iframe) as whirl writes it, exactly like a document. `finalize`
 * closes out the row the stream loop opened. Paid-only; the stream loop only
 * wires this tool in for paid users.
 */
export function createInlineHtmlTool({
  finalize,
  onResult,
}: {
  finalize: (args: {
    toolCallId: string;
    title: string;
    html: string;
  }) => Promise<{ htmlId: Id<"htmlArtifacts"> }>;
  onResult: (payload: HtmlPhasePayload) => Promise<void>;
}) {
  return tool({
    description: "Render one compact HTML visualization or demo inline.",
    inputSchema: jsonSchema<{ title?: string; html: string }>({
      type: "object",
      properties: {
        title: {
          type: "string",
          maxLength: MAX_TITLE_LENGTH,
          description: "Optional short label.",
        },
        html: {
          type: "string",
          minLength: 1,
          maxLength: MAX_HTML_LENGTH,
          description: `Self-contained HTML fragment. Put last.\n\n${HTML_THEME_REFERENCE}`,
        },
      },
      required: ["html"],
      additionalProperties: false,
    }),
    execute: async ({ title, html }, { toolCallId }) => {
      const cleanTitle = (title ?? "").trim().slice(0, MAX_TITLE_LENGTH);
      const { htmlId } = await finalize({ toolCallId, title: cleanTitle, html });
      await onResult({
        op: "create",
        mode: "inline",
        htmlId,
        ...(cleanTitle ? { title: cleanTitle } : {}),
      });
      return {
        htmlId,
        ok: true,
        note: "Inline visualization rendered to the user. Revise it later with editHtml using this id.",
      };
    },
  });
}

/**
 * Lets whirl write a full, standalone HTML page (e.g. a study guide, cheat
 * sheet, interactive explainer) that opens in the side panel. Written directly
 * by the main agent, exactly like an inline visualization — the body streams
 * live into the artifact row as the tool input arrives, and `finalize` closes
 * out the row the stream loop opened. Paid-only.
 */
export function createFullHtmlTool({
  finalize,
  onResult,
}: {
  finalize: (args: {
    toolCallId: string;
    title: string;
    html: string;
  }) => Promise<{ htmlId: Id<"htmlArtifacts"> }>;
  onResult: (payload: HtmlPhasePayload) => Promise<void>;
}) {
  return tool({
    description:
      "Write a complete, keepable multi-section HTML page that opens in the side panel.",
    inputSchema: jsonSchema<{ title: string; html: string }>({
      type: "object",
      properties: {
        title: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TITLE_LENGTH,
          description: "Short page title.",
        },
        html: {
          type: "string",
          minLength: 1,
          maxLength: MAX_HTML_LENGTH,
          description: `Complete self-contained HTML page as a body fragment. Put last.\n\n${HTML_THEME_REFERENCE}\n\n${FULL_PAGE_DESIGN_NOTES}`,
        },
      },
      required: ["title", "html"],
      additionalProperties: false,
    }),
    execute: async ({ title, html }, { toolCallId }) => {
      const cleanTitle = title.trim().slice(0, MAX_TITLE_LENGTH) || "Untitled";
      const { htmlId } = await finalize({ toolCallId, title: cleanTitle, html });
      await onResult({ op: "create", mode: "full", htmlId, title: cleanTitle });
      return {
        htmlId,
        title: cleanTitle,
        ok: true,
        note: "Full page rendered and opened in the side panel for the user. Revise it later with editHtml using this id.",
      };
    },
  });
}

/**
 * Lets whirl revise an existing HTML artifact (inline or full) with targeted
 * find/replace edits, so only the changed regions update. Each `find` must match
 * the artifact's CURRENT html exactly and appear once — the current html of each
 * artifact in the thread is given to the model in its prompt, so it copies
 * anchors verbatim; any miss is reported back with the current content to retry.
 */
export function createEditHtmlTool({
  applyEdits,
  onResult,
  onNoChange,
}: {
  applyEdits: (args: {
    htmlId: Id<"htmlArtifacts">;
    edits: { find: string; replace: string }[];
  }) => Promise<ApplyHtmlEditsResult>;
  onResult: (payload: HtmlPhasePayload) => Promise<void>;
  /** Called when an edit landed nothing, so the pending card is dropped while
   * the model still gets the misses to retry. */
  onNoChange: () => Promise<void>;
}) {
  return tool({
    description:
      "Edit an existing HTML artifact with exact, unique current-HTML replacements.",
    inputSchema: jsonSchema<{
      htmlId: string;
      edits: { find: string; replace: string }[];
    }>({
      type: "object",
      properties: {
        htmlId: {
          type: "string",
          description: "HTML artifact id.",
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
                description: "Exact unique current-HTML substring.",
              },
              replace: {
                type: "string",
                description: "Replacement HTML; empty deletes.",
              },
            },
            required: ["find", "replace"],
            additionalProperties: false,
          },
        },
      },
      required: ["htmlId", "edits"],
      additionalProperties: false,
    }),
    execute: async ({ htmlId, edits }) => {
      const id = htmlId as Id<"htmlArtifacts">;
      const result = await applyEdits({
        htmlId: id,
        edits: edits.slice(0, MAX_EDITS_PER_CALL),
      });
      if (result.applied > 0) {
        await onResult({
          op: "edit",
          mode: result.kind,
          htmlId: id,
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
