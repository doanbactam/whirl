import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { IconFile } from "@tabler/icons-react";

import type { Editor } from "@tiptap/react";

import {
  CloseButton,
  FullscreenToggle,
  useArtifactShell,
} from "~/components/artifact-shell";
import { fileMeta } from "~/components/attachment-card";
import { DocumentDownloadMenu } from "~/components/document-download-menu";
import { MarkdownEditor } from "~/components/markdown-editor";
import { formatSize } from "~/lib/attachment-upload";
import { useComposerIngest } from "~/lib/composer-ingest";
import { useDocumentSidebar } from "~/lib/document-sidebar";
import { useIsSharedArtifacts, useLiveDocument } from "~/lib/shared-artifacts";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";
import { useMinMd } from "~/lib/use-media";

/**
 * The document panel. On desktop it lives inline in the shell as a resizable
 * panel that pushes the chat aside (mount it inside the content flex row); on
 * mobile it drops down to a full-screen overlay. It hosts a full TipTap markdown
 * editor and shows whichever document {@link useDocumentSidebar} has open — an
 * attachment/composer draft (`doc`) or a whirl-authored live row (`liveDocId`).
 * The resizable/fullscreen shell itself is shared with the HTML panel (see
 * artifact-shell).
 */
export function DocumentSidebar() {
  const { doc, liveDocId, closeDocument, fullscreen } = useDocumentSidebar();
  const minMd = useMinMd();
  const Shell = useArtifactShell();
  // Fullscreen only applies to the desktop embedded panel; the mobile overlay
  // already covers everything.
  const isFullscreen = minMd && fullscreen;

  return (
    <AnimatePresence initial={false}>
      {doc ? (
        <Shell
          key={doc.attachment.id}
          onClose={closeDocument}
          fullscreen={isFullscreen}
        >
          <PanelContents
            attachment={doc.attachment}
            onEdit={doc.onEdit}
            onClose={closeDocument}
          />
        </Shell>
      ) : liveDocId ? (
        <Shell
          key={`live:${liveDocId}`}
          onClose={closeDocument}
          fullscreen={isFullscreen}
        >
          <LiveDocumentContents documentId={liveDocId} onClose={closeDocument} />
        </Shell>
      ) : null}
    </AnimatePresence>
  );
}

type PanelContentProps = {
  attachment: {
    id: string;
    name: string;
    type: string;
    size: number;
    text?: string;
  };
  onEdit?: (markdown: string) => void;
  onClose: () => void;
};

/** Header + editor for an attachment / composer-draft document. */
function PanelContents({ attachment, onEdit, onClose }: PanelContentProps) {
  const capture = useCapture();
  const { resetNonce } = useDocumentSidebar();
  const [edited, setEdited] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const initialText = attachment.text ?? "";
  const meta = fileMeta(attachment.name, attachment.type);
  const MetaIcon = meta.icon;

  const handleChange = (next: string) => {
    if (next === initialText) return;
    onEdit?.(next);
    if (!edited) {
      setEdited(true);
      capture(ANALYTICS_EVENTS.documentSidebarEdited, { type: attachment.type });
    }
  };

  // When the edits get discarded (from the composer), the editor snaps back to
  // the original text — so drop the "edited" marker to match.
  useEffect(() => {
    setEdited(false);
  }, [resetNonce]);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-black/[0.06] px-4 dark:border-white/[0.06]">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.tint}`}
        >
          <MetaIcon size={16} stroke={2} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
            {attachment.name}
          </span>
          <span className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
            {meta.label} · {formatSize(attachment.size)}
            {edited ? " · edited" : ""}
          </span>
        </span>
        <DocumentDownloadMenu editor={editor} name={attachment.name} />
        <FullscreenToggle
          onToggle={(next) =>
            capture(ANALYTICS_EVENTS.documentFullscreenToggled, {
              fullscreen: next,
            })
          }
        />
        <CloseButton onClose={onClose} label="Close document" />
      </header>
      <div className="min-h-0 flex-1">
        <MarkdownEditor
          value={initialText}
          onChange={handleChange}
          onEditorReady={setEditor}
          resetSignal={resetNonce}
        />
      </div>
    </>
  );
}

const updateDocumentContentRef = makeFunctionReference<"mutation">(
  "documents:updateDocumentContent",
);

const SAVE_DEBOUNCE_MS = 600;

/**
 * The panel contents for a first-class, whirl-authored document. Reads a live
 * `documents` row: while whirl is writing it (`status: "streaming"`) the editor
 * mirrors the body as it fills in and stays read-only; once complete the user
 * can edit it (debounced save-back), and a later whirl revision swaps the text
 * in with a soft highlight sweep so the change is seen.
 */
function LiveDocumentContents({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}) {
  const capture = useCapture();
  const { addDocumentSelection } = useComposerIngest();
  // On a public share page the doc is injected read-only (no auth to save back).
  const shared = useIsSharedArtifacts();
  const doc = useLiveDocument(documentId);
  const updateContent = useMutation(updateDocumentContentRef);
  const [editor, setEditor] = useState<Editor | null>(null);

  const streaming = doc?.status === "streaming";

  // The text the editor renders. Swapped on initial load, on every streaming
  // tick, and on a whirl edit — but never on the user's own save echo, so a
  // live query update can't yank text out from under someone mid-edit.
  const [displayValue, setDisplayValue] = useState<string | null>(null);
  // Tells the editor to flash the changed region on the *next* swap. On only
  // for genuine whirl revisions — never during streaming or the swap that lands
  // the final body, so the doc doesn't flash while it's still being written.
  const [highlightEdits, setHighlightEdits] = useState(false);
  const prevContentRef = useRef("");
  const lastLocalRef = useRef<string | null>(null);
  const editedOnceRef = useRef(false);
  const wasStreamingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const title = doc?.title?.trim() || "Document";

  useEffect(() => {
    if (doc === undefined) return; // still loading
    const content = doc?.content ?? "";
    if (displayValue === null) {
      setDisplayValue(content);
      prevContentRef.current = content;
      wasStreamingRef.current = streaming;
      return;
    }
    const justFinishedStreaming = wasStreamingRef.current && !streaming;
    wasStreamingRef.current = streaming;
    if (content === prevContentRef.current) return;
    const isLocalEcho = content === lastLocalRef.current;
    prevContentRef.current = content;
    if (streaming) {
      // Mirror the body as it streams in; no flash, the editor follows the tail.
      setHighlightEdits(false);
      setDisplayValue(content);
    } else if (!isLocalEcho) {
      // Whirl revised the doc out from under us — show it and flash the changed
      // region, unless this swap is just the stream settling to its final text.
      setHighlightEdits(!justFinishedStreaming);
      setDisplayValue(content);
    }
  }, [doc, displayValue, streaming]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const handleChange = (next: string) => {
    if (next === prevContentRef.current) return;
    lastLocalRef.current = next;
    if (!editedOnceRef.current) {
      editedOnceRef.current = true;
      capture(ANALYTICS_EVENTS.documentManuallyEdited, {
        document_id: documentId,
      });
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void updateContent({ documentId, content: next });
    }, SAVE_DEBOUNCE_MS);
  };

  const handleAddSelection = (selectedText: string) => {
    addDocumentSelection({ documentId, title, selectedText });
    capture(ANALYTICS_EVENTS.documentSelectionAddedToChat, {
      document_id: documentId,
      length: selectedText.length,
    });
  };

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-black/[0.06] px-4 dark:border-white/[0.06]">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-neutral-600 dark:bg-white/[0.06] dark:text-neutral-300">
          <IconFile size={16} stroke={2} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
            {title}
          </span>
          <span className="flex items-center gap-1.5 truncate text-[11px] text-neutral-500 dark:text-neutral-400">
            {streaming ? (
              <>
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-500/80" />
                Writing…
              </>
            ) : (
              <>
                Document
                {displayValue !== null
                  ? ` · ${formatSize(new Blob([displayValue]).size)}`
                  : ""}
              </>
            )}
          </span>
        </span>
        <DocumentDownloadMenu editor={editor} name={`${title}.md`} />
        <FullscreenToggle
          onToggle={(next) =>
            capture(ANALYTICS_EVENTS.documentFullscreenToggled, {
              fullscreen: next,
            })
          }
        />
        <CloseButton onClose={onClose} label="Close document" />
      </header>
      <div className="relative min-h-0 flex-1">
        {doc === null ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-neutral-500 dark:text-neutral-400">
            This document isn't available anymore.
          </div>
        ) : displayValue === null ? (
          <div className="px-5 py-4">
            <div className="h-3 w-2/3 animate-pulse rounded bg-black/[0.06] dark:bg-white/[0.08]" />
          </div>
        ) : (
          <MarkdownEditor
            value={displayValue}
            onChange={handleChange}
            editable={!streaming && !shared}
            onEditorReady={setEditor}
            stickToBottom={streaming}
            highlightEdits={highlightEdits}
            onAddSelectionToChat={
              streaming || shared ? undefined : handleAddSelection
            }
          />
        )}
      </div>
    </>
  );
}
