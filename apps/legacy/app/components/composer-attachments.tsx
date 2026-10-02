import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconX } from "@tabler/icons-react";

import {
  AttachmentCard,
  AttachmentImageThumb,
} from "~/components/attachment-card";
import { EditedDocPill } from "~/components/edited-doc-pill";
import { AttachmentPreviewModal } from "~/components/attachment-preview-modal";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { ImageViewer } from "~/components/image-viewer";
import type { AttachmentDraft } from "~/components/use-attachment-uploads";
import {
  attachmentKind,
  isMarkdownAttachment,
  openInNewTab,
} from "~/lib/attachment-open";
import { useDocumentSidebar } from "~/lib/document-sidebar";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

/**
 * The composer's attachment tray: each picked file shows up as a card (or image
 * thumbnail) with an upload progress bar, mirroring how attachments look in the
 * chat. Click an image to zoom, a text file to read and edit it, anything else
 * to pop it open in a new tab.
 */
export function ComposerAttachments({
  drafts,
  rejectionReason,
  onRemove,
  onEditText,
}: {
  drafts: AttachmentDraft[];
  rejectionReason: (draft: AttachmentDraft) => string | null;
  onRemove: (id: string) => void;
  onEditText: (id: string, text: string) => void;
}) {
  const capture = useCapture();
  const { openDocument, revertOpenDocument } = useDocumentSidebar();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  // A draft pending a "really discard your edits?" confirmation before removal.
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  // Text the preview opened with, so we only track an edit when it changes.
  const previewOriginal = useRef("");

  const preview = drafts.find((d) => d.id === previewId);
  const image = drafts.find((d) => d.id === imageId);
  const confirmRemove = drafts.find((d) => d.id === confirmRemoveId);

  // Chips carrying edits to a sent document (sourceKey set) don't vanish on a
  // single click — removing them throws the edits away, so we confirm first.
  const requestRemove = (draft: AttachmentDraft) => {
    if (draft.sourceKey) {
      setConfirmRemoveId(draft.id);
      return;
    }
    onRemove(draft.id);
  };

  // Pop a non-image, non-text file open in a new tab. Prefer the uploaded URL;
  // fall back to a throwaway object URL while the upload is still in flight.
  const openFile = (draft: AttachmentDraft) => {
    const url = draft.attachment?.url ?? URL.createObjectURL(draft.file);
    openInNewTab(url);
    capture(ANALYTICS_EVENTS.attachmentOpenedInNewTab, { type: draft.type });
  };

  return (
    <div className="flex flex-wrap gap-2 px-2.5 pt-2.5">
      <AnimatePresence initial={false} mode="popLayout">
        {drafts.map((draft) => (
          <motion.div
            key={draft.id}
            layout
            initial={{ opacity: 0, scale: 0.9, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 4 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
          >
            <DraftItem
              draft={draft}
              rejection={rejectionReason(draft)}
              onRemove={() => requestRemove(draft)}
              onOpenText={() => {
                previewOriginal.current = draft.text ?? "";
                setPreviewId(draft.id);
                capture(ANALYTICS_EVENTS.attachmentPreviewOpened, {
                  type: draft.type,
                });
              }}
              onOpenDocument={() => {
                capture(ANALYTICS_EVENTS.documentSidebarOpened, {
                  type: draft.type,
                });
                openDocument(
                  {
                    id: draft.id,
                    name: draft.name,
                    size: draft.size,
                    type: draft.type,
                    text: draft.text ?? "",
                  },
                  (text) => onEditText(draft.id, text),
                );
              }}
              onOpenImage={() => setImageId(draft.id)}
              onOpenFile={() => openFile(draft)}
            />
          </motion.div>
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {preview && preview.text != null && (
          <AttachmentPreviewModal
            key="text-preview"
            name={preview.name}
            type={preview.type}
            size={preview.size}
            text={preview.text}
            onChange={(text) => onEditText(preview.id, text)}
            onClose={() => {
              if (preview.text !== previewOriginal.current) {
                capture(ANALYTICS_EVENTS.attachmentEdited, {
                  type: preview.type,
                });
              }
              setPreviewId(null);
            }}
          />
        )}
        {image?.previewUrl && (
          <ImageViewer
            key="image-viewer"
            src={image.previewUrl}
            alt={image.name}
            onClose={() => setImageId(null)}
          />
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmRemove != null}
        tone="danger"
        title="Discard your edits?"
        message={
          confirmRemove
            ? `Removing “${confirmRemove.name}” drops the edits you made — whirl won't see them.`
            : undefined
        }
        confirmLabel="Discard edits"
        cancelLabel="Keep editing"
        onConfirm={() => {
          if (confirmRemove) {
            capture(ANALYTICS_EVENTS.documentEditsDiscarded, {
              type: confirmRemove.type,
            });
            // Snap the open editor back to the original before dropping the chip.
            if (confirmRemove.sourceKey) {
              revertOpenDocument(confirmRemove.sourceKey);
            }
            onRemove(confirmRemove.id);
          }
          setConfirmRemoveId(null);
        }}
        onCancel={() => setConfirmRemoveId(null)}
      />
    </div>
  );
}

function DraftItem({
  draft,
  rejection,
  onRemove,
  onOpenText,
  onOpenDocument,
  onOpenImage,
  onOpenFile,
}: {
  draft: AttachmentDraft;
  rejection: string | null;
  onRemove: () => void;
  onOpenText: () => void;
  onOpenDocument: () => void;
  onOpenImage: () => void;
  onOpenFile: () => void;
}) {
  const isImage = draft.type.startsWith("image/") && Boolean(draft.previewUrl);
  const hasError = draft.status === "error" || rejection !== null;
  const errorText = rejection ?? (draft.status === "error" ? draft.error : null);
  const uploading = draft.status === "uploading";
  const showBar = uploading || draft.status === "error";
  // Text files open the editable viewer once their contents have loaded;
  // anything else opens in a new tab. Don't route while it's still erroring.
  const kind = attachmentKind(draft.name, draft.type, draft.text != null);
  const isMarkdown = isMarkdownAttachment(draft.name, draft.type);
  // A chip that's carrying edits back to a sent document gets a distinct look.
  const isEdited = Boolean(draft.sourceKey);
  const onOpen = hasError
    ? undefined
    : kind === "text"
      ? draft.text != null
        ? isMarkdown
          ? onOpenDocument
          : onOpenText
        : undefined
      : onOpenFile;

  if (isImage && draft.previewUrl) {
    return (
      <div className="group/att relative flex flex-col gap-1">
        <AttachmentImageThumb
          src={draft.previewUrl}
          alt={draft.name}
          onClick={onOpenImage}
          dimmed={uploading}
        />
        {showBar && <UploadBar progress={draft.progress} error={hasError} />}
        <RemoveButton onRemove={onRemove} name={draft.name} />
      </div>
    );
  }

  // Edited docs ride as plain text (no upload), so they get a compact neutral
  // pill rather than the full file card. Errors still fall through to the card.
  if (isEdited && !hasError) {
    return (
      <EditedDocPill
        name={draft.name}
        type={draft.type}
        onClick={onOpen}
        onRemove={onRemove}
        removeLabel={`Discard edits to ${draft.name}`}
      />
    );
  }

  return (
    <AttachmentCard
      name={draft.name}
      type={draft.type}
      size={draft.size}
      error={hasError}
      highlighted={isEdited && !hasError}
      badge={isEdited && !hasError ? "Edited" : undefined}
      subtitle={
        errorText ??
        (uploading
          ? "Uploading…"
          : isEdited
            ? "Edits ready to send"
            : undefined)
      }
      removeLabel={isEdited ? `Discard edits to ${draft.name}` : undefined}
      onClick={onOpen}
      onRemove={onRemove}
      footer={
        showBar ? <UploadBar progress={draft.progress} error={hasError} /> : undefined
      }
    />
  );
}

function UploadBar({ progress, error }: { progress: number; error: boolean }) {
  if (error) {
    return <div className="h-1 w-full rounded-full bg-red-500/60" />;
  }
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.1]">
      <motion.div
        className="h-full rounded-full bg-[#0c82f2]"
        initial={false}
        animate={{ width: `${Math.max(6, Math.round(progress * 100))}%` }}
        transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
      />
    </div>
  );
}

function RemoveButton({
  onRemove,
  name,
}: {
  onRemove: () => void;
  name: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Remove ${name}`}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-black/[0.06] bg-white text-neutral-500 opacity-0 shadow-sm transition-opacity hover:text-neutral-800 group-hover/att:opacity-100 focus-visible:opacity-100 dark:border-white/[0.1] dark:bg-[#2a2a2a] dark:text-neutral-300 dark:hover:text-neutral-100"
    >
      <IconX size={11} stroke={2.5} />
    </button>
  );
}
