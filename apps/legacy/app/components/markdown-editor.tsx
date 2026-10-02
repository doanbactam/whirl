import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "tiptap-markdown";
import { AnimatePresence, motion } from "motion/react";
import { IconMessagePlus } from "@tabler/icons-react";

import { MarkdownToolbar } from "~/components/markdown-toolbar";
import { TableMenu } from "~/components/editor/table-menu";
import { BlockMath, InlineMath } from "~/components/editor/math-extension";
import { normalizeMathDelimiters } from "~/components/markdown/normalize-math";
import {
  EditHighlight,
  clearEditHighlight,
  flashEditHighlight,
} from "~/components/editor/edit-highlight";

/** tiptap-markdown registers this on `editor.storage` but ships no types. */
function getMarkdown(editor: Editor): string {
  return (
    editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  ).markdown.getMarkdown();
}

/** The text inserted going from `prev` to `next` (the changed middle span). */
function insertedSpan(prev: string, next: string): string {
  const max = Math.min(prev.length, next.length);
  let p = 0;
  while (p < max && prev[p] === next[p]) p += 1;
  let s = 0;
  while (
    s < max - p &&
    prev[prev.length - 1 - s] === next[next.length - 1 - s]
  ) {
    s += 1;
  }
  return next.slice(p, next.length - s);
}

/** A floating "add to chat" button anchored to the current text selection. */
type SelectionAnchor = { top: number; left: number; text: string };

/**
 * A TipTap rich-text editor that reads and writes Markdown. Hand it a markdown
 * string; it renders a fully editable WYSIWYG surface and reports edits back as
 * markdown via `onChange`. Editing is optional — leave `onChange` off for a
 * pristine read-only render.
 */
export function MarkdownEditor({
  value,
  onChange,
  editable = true,
  onEditorReady,
  resetSignal,
  stickToBottom = false,
  highlightEdits = false,
  onAddSelectionToChat,
}: {
  value: string;
  onChange?: (markdown: string) => void;
  editable?: boolean;
  /** Surfaces the editor instance (e.g. so a parent toolbar can export it). */
  onEditorReady?: (editor: Editor | null) => void;
  /**
   * Bump this to force the editor's content back to `value`, throwing away any
   * in-progress edits. Useful when a parent wants to discard local changes.
   */
  resetSignal?: number;
  /**
   * Keep the view pinned to the end as `value` grows — used while whirl streams
   * a document in, so the panel follows the text being written.
   */
  stickToBottom?: boolean;
  /**
   * When true, an externally-driven `value` change (whirl revising a document)
   * flashes a highlight over exactly the region that changed, so the edit is
   * seen as it lands rather than appearing out of nowhere.
   */
  highlightEdits?: boolean;
  /**
   * When provided, selecting text reveals a floating "add to chat" button that
   * hands the selected markdown back so the user can ask whirl to revise it.
   */
  onAddSelectionToChat?: (selectedText: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<SelectionAnchor | null>(null);

  // Position the floating button just above the end of the current selection,
  // in coordinates relative to the editor container. Cleared when the selection
  // collapses or the editor loses focus.
  const refreshSelection = useCallback(
    (editor: Editor) => {
      if (!onAddSelectionToChat) return;
      const { from, to, empty } = editor.state.selection;
      const container = containerRef.current;
      if (empty || !container) {
        setSelection(null);
        return;
      }
      const text = editor.state.doc.textBetween(from, to, "\n").trim();
      if (!text) {
        setSelection(null);
        return;
      }
      const end = editor.view.coordsAtPos(to);
      const box = container.getBoundingClientRect();
      setSelection({
        top: end.top - box.top + container.scrollTop - 40,
        left: Math.min(Math.max(end.left - box.left, 12), box.width - 140),
        text,
      });
    },
    [onAddSelectionToChat],
  );

  // Math delimiters are canonicalized to `$$…$$` on the way in — the same
  // normalization the chat renderer uses — so `\(…\)`, `\[…\]`, and math-looking
  // single-`$` spans all typeset, and the editor only has to parse one form.
  const normalized = useMemo(() => normalizeMathDelimiters(value), [value]);

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit,
      TableKit.configure({ table: { resizable: true } }),
      InlineMath,
      BlockMath,
      Markdown.configure({
        html: false,
        linkify: true,
        breaks: true,
        transformPastedText: true,
      }),
      EditHighlight,
    ],
    content: normalized,
    editorProps: {
      attributes: {
        // `tiptap-prose` drives the typography styles in app.css.
        class:
          "tiptap-prose min-h-full max-w-none px-5 py-4 outline-none focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      onChange?.(getMarkdown(editor));
    },
    onSelectionUpdate: ({ editor }) => {
      refreshSelection(editor);
    },
  });

  // Swap in fresh content when the source changes underneath us (opening a
  // different file, whirl streaming a doc in, or whirl revising it). emitUpdate
  // stays off so this never loops back as an edit.
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sweepNonce, setSweepNonce] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const current = getMarkdown(editor);
    if (current === normalized) return;

    // Figure out what changed *before* swapping content, so we can highlight it.
    const inserted = highlightEdits ? insertedSpan(current, normalized) : "";
    editor.commands.setContent(normalized, { emitUpdate: false });

    // Follow the tail as a document streams in.
    if (stickToBottom) {
      requestAnimationFrame(() => {
        const el = containerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
    // Paint the changed region; if we can't anchor it (pure deletion, or a
    // block-level change we can't map), fall back to a soft full-surface sweep.
    if (highlightEdits) {
      requestAnimationFrame(() => {
        const painted = inserted.trim()
          ? flashEditHighlight(editor, [inserted])
          : false;
        if (!painted) setSweepNonce((n) => n + 1);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => clearEditHighlight(editor), 1600);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized, editor]);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  // Snap back to the source text on demand, discarding local edits. Skips the
  // initial mount (content already starts at `value`) so it only fires on a bump.
  const didMountReset = useRef(false);
  useEffect(() => {
    if (!editor) return;
    if (!didMountReset.current) {
      didMountReset.current = true;
      return;
    }
    editor.commands.setContent(normalized, { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal, editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  const handleAddSelection = () => {
    if (!selection) return;
    onAddSelectionToChat?.(selection.text);
    setSelection(null);
    editor?.commands.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {editable && editor && (
        <div className="sticky top-0 z-10">
          <MarkdownToolbar editor={editor} />
        </div>
      )}
      {editable && editor && <TableMenu editor={editor} />}
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        {/* Cap the text column for readability — no effect in the narrow docked
            panel, keeps it from sprawling when the panel goes fullscreen. */}
        <EditorContent editor={editor} className="mx-auto h-full w-full max-w-3xl" />

        {/* Edit couldn't be pinned to a region: a soft sweep so it registers. */}
        <AnimatePresence>
          {sweepNonce ? (
            <motion.div
              key={sweepNonce}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.1, ease: "easeOut", times: [0, 0.25, 1] }}
              className="pointer-events-none absolute inset-0 bg-gradient-to-b from-amber-300/20 via-amber-200/10 to-transparent dark:from-amber-300/10 dark:via-amber-200/[0.06]"
            />
          ) : null}
        </AnimatePresence>

        {/* Selection → "add to chat" affordance. */}
        <AnimatePresence>
          {selection && onAddSelectionToChat ? (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.96 }}
              transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
              style={{ top: selection.top, left: selection.left }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleAddSelection}
              className="absolute z-20 flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-2.5 py-1.5 text-[12px] font-medium text-neutral-700 shadow-md transition-colors hover:bg-neutral-50 dark:border-white/[0.1] dark:bg-[#2a2a2a] dark:text-neutral-100 dark:hover:bg-[#323232]"
            >
              <IconMessagePlus size={14} stroke={2} />
              Add to chat
            </motion.button>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
