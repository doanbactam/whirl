import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  IconArrowUpRight,
  IconBrowser,
  IconCircleCheckFilled,
  IconCopy,
  IconFile,
  IconLibrary,
  IconLink,
  IconMarkdown,
  IconPhoto,
  IconShare,
} from "@tabler/icons-react";
import type { TablerIcon } from "@tabler/icons-react";

import { COMPOSER_GLASS_CONTROL } from "~/components/composer";
import { ConfirmDialog } from "~/components/confirm-dialog";
import {
  DropdownShell,
  dropdownDividerClass,
  dropdownItemClass,
} from "~/components/dropdown-menu";
import type { Attachment } from "~/data/messages";
import {
  useThreadArtifacts,
  type ThreadDocument,
  type ThreadVisualization,
} from "~/data/thread-artifacts";
import { useThreadActions } from "~/data/threads";
import { showToast } from "~/data/toasts";
import {
  attachmentKind,
  isMarkdownAttachment,
  openInNewTab,
} from "~/lib/attachment-open";
import { useDocumentSidebar } from "~/lib/document-sidebar";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";
import { shareRawUrl, shareUrl } from "~/lib/share";

/** Dismiss an open layer on outside-click or Escape. */
function useDismiss(
  open: boolean,
  onClose: () => void,
  refs: Array<React.RefObject<HTMLElement | null>>,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (refs.some((r) => r.current?.contains(target))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // refs is a stable-length array of stable refs from the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);
}

// Floating frosted-glass pill in the top-right corner, matching the composer's
// glass controls — translucent so the chat scrolls through behind it.
const toolbarButtonClass = `flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-neutral-700 dark:text-neutral-200 ${COMPOSER_GLASS_CONTROL}`;

const menuPanelMotion = {
  initial: { opacity: 0, y: -6, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.97 },
  transition: { duration: 0.14, ease: [0.22, 0.61, 0.36, 1] as const },
};

/**
 * The thread's top-right toolbar: a menu of everything whirl made in the thread
 * (documents, visualizations, attachments) and a button to share the thread as a
 * public read-only link. Floating frosted-glass pills pinned to the top-right
 * corner of the chat surface.
 */
export function ThreadToolbar({
  threadId,
  threadTitle,
  shareId,
  attachments,
}: {
  threadId: string;
  threadTitle: string;
  shareId: string | null;
  attachments: Attachment[];
}) {
  const { documents, visualizations } = useThreadArtifacts(threadId);

  // Attachments ride on the messages; dedupe by id and keep only ones we can
  // actually open (an image/file we have a URL for, or text we captured).
  const attachmentItems = useMemo(() => {
    const seen = new Set<string>();
    const items: Attachment[] = [];
    for (const a of attachments) {
      if (seen.has(a.id)) continue;
      const canOpen =
        Boolean(a.url) ||
        a.text != null ||
        isMarkdownAttachment(a.name, a.type);
      if (!canOpen) continue;
      seen.add(a.id);
      items.push(a);
    }
    return items;
  }, [attachments]);

  const hasArtifacts =
    documents.length + visualizations.length + attachmentItems.length > 0;

  // Small glass chips floating in the top-right corner of the chat surface.
  return (
    <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5">
      {hasArtifacts && (
        <ArtifactsMenu
          documents={documents}
          visualizations={visualizations}
          attachments={attachmentItems}
        />
      )}
      <ShareControl
        threadId={threadId}
        threadTitle={threadTitle}
        shareId={shareId}
      />
    </div>
  );
}

function ArtifactsMenu({
  documents,
  visualizations,
  attachments,
}: {
  documents: ThreadDocument[];
  visualizations: ThreadVisualization[];
  attachments: Attachment[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const capture = useCapture();
  const { openDocumentById, openHtmlById, openDocument } = useDocumentSidebar();
  useDismiss(open, () => setOpen(false), [wrapRef]);

  const total = documents.length + visualizations.length + attachments.length;

  const select = (
    kind: "document" | "visualization" | "attachment",
    run: () => void,
  ) => {
    capture(ANALYTICS_EVENTS.threadArtifactOpened, { kind });
    setOpen(false);
    run();
  };

  const openAttachment = (a: Attachment) => {
    if (isMarkdownAttachment(a.name, a.type)) {
      openDocument(a);
      return;
    }
    if (a.text != null) {
      openDocument(a);
      return;
    }
    if (a.url) {
      openInNewTab(a.url);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => {
            if (!v) capture(ANALYTICS_EVENTS.threadArtifactsMenuOpened, { total });
            return !v;
          });
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Thread files"
        title="Documents, visualizations & attachments"
        className={toolbarButtonClass}
      >
        <IconLibrary size={16} stroke={2} />
        <span className="tabular-nums">{total}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            {...menuPanelMotion}
            role="menu"
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-full z-40 mt-2 w-72"
          >
            <DropdownShell>
            <div className="max-h-[min(70vh,28rem)] overflow-y-auto">
            {visualizations.length > 0 && (
              <MenuSection label="Visualizations">
                {visualizations.map((v) => (
                  <ArtifactItem
                    key={v.id}
                    icon={IconBrowser}
                    title={v.title}
                    subtitle={v.kind === "full" ? "Page" : "Visualization"}
                    onClick={() =>
                      select("visualization", () => openHtmlById(v.id))
                    }
                  />
                ))}
              </MenuSection>
            )}
            {documents.length > 0 && (
              <MenuSection label="Documents">
                {documents.map((d) => (
                  <ArtifactItem
                    key={d.id}
                    icon={IconFile}
                    title={d.title}
                    subtitle="Document"
                    onClick={() =>
                      select("document", () => openDocumentById(d.id))
                    }
                  />
                ))}
              </MenuSection>
            )}
            {attachments.length > 0 && (
              <MenuSection label="Attachments">
                {attachments.map((a) => (
                  <ArtifactItem
                    key={a.id}
                    icon={
                      attachmentKind(a.name, a.type, a.text != null) === "image"
                        ? IconPhoto
                        : IconFile
                    }
                    title={a.name}
                    subtitle={attachmentSubtitle(a)}
                    onClick={() => select("attachment", () => openAttachment(a))}
                  />
                ))}
              </MenuSection>
            )}
            </div>
            </DropdownShell>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function attachmentSubtitle(a: Attachment): string {
  const kind = attachmentKind(a.name, a.type, a.text != null);
  if (kind === "image") return "Image";
  if (kind === "text") return "Text";
  return "File";
}

function MenuSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="first:mt-0 [&+&]:mt-1 [&+&]:border-t [&+&]:border-black/[0.06] [&+&]:pt-1 dark:[&+&]:border-white/[0.06]">
      <div className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium tracking-wide text-neutral-400 dark:text-neutral-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function ArtifactItem({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: TablerIcon;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  const Glyph = icon;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`group/item ${dropdownItemClass}`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-neutral-600 dark:bg-white/[0.06] dark:text-neutral-300">
        <Glyph size={15} stroke={2} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
          {title}
        </span>
        <span className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
          {subtitle}
        </span>
      </span>
      <IconArrowUpRight
        size={14}
        stroke={2}
        className="shrink-0 text-neutral-400 opacity-0 transition-opacity group-hover/item:opacity-100 dark:text-neutral-500"
      />
    </button>
  );
}

function ShareControl({
  threadId,
  threadTitle,
  shareId,
}: {
  threadId: string;
  threadTitle: string;
  shareId: string | null;
}) {
  const { shareThread, unshareThread } = useThreadActions();
  const capture = useCapture();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  // Once we mint a token, show it immediately even before the thread list query
  // round-trips the new shareId back into props.
  const [localShareId, setLocalShareId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const copyResetRef = useRef<number | null>(null);

  const effectiveShareId = shareId ?? localShareId;
  useDismiss(popoverOpen, () => setPopoverOpen(false), [wrapRef]);

  useEffect(
    () => () => {
      if (copyResetRef.current != null) window.clearTimeout(copyResetRef.current);
    },
    [],
  );

  const onShareClick = () => {
    if (effectiveShareId) {
      setPopoverOpen((v) => !v);
      return;
    }
    setConfirmOpen(true);
  };

  const createShare = async () => {
    setConfirmOpen(false);
    setCreating(true);
    try {
      const id = await shareThread(threadId);
      setLocalShareId(id);
      setPopoverOpen(true);
    } catch {
      showToast({ tone: "danger", message: "Couldn't create a share link." });
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async () => {
    if (!effectiveShareId) return;
    try {
      await navigator.clipboard.writeText(shareUrl(effectiveShareId));
      capture(ANALYTICS_EVENTS.threadShareLinkCopied, { thread_id: threadId });
      if (copyResetRef.current != null) window.clearTimeout(copyResetRef.current);
      setCopied(true);
      copyResetRef.current = window.setTimeout(() => setCopied(false), 1600);
      showToast({ tone: "success", message: "Link copied to clipboard." });
    } catch {
      // Clipboard may be blocked (insecure context); ignore.
    }
  };

  const stopSharing = async () => {
    setPopoverOpen(false);
    setLocalShareId(null);
    try {
      await unshareThread(threadId);
      showToast({ message: "Sharing stopped. The link no longer works." });
    } catch {
      showToast({ tone: "danger", message: "Couldn't stop sharing." });
    }
  };

  const isShared = Boolean(effectiveShareId);
  const ShareGlyph = isShared ? IconLink : IconShare;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={onShareClick}
        disabled={creating}
        aria-haspopup={isShared ? "menu" : "dialog"}
        aria-expanded={popoverOpen}
        title={isShared ? "Manage share link" : "Share this thread"}
        className={`${toolbarButtonClass} disabled:opacity-60 ${
          isShared
            ? "text-[#0c82f2] dark:text-[#4aa3ff]"
            : ""
        }`}
      >
        <ShareGlyph size={16} stroke={2} />
        <span className="max-sm:hidden">{isShared ? "Shared" : "Share"}</span>
      </button>

      <AnimatePresence>
        {popoverOpen && effectiveShareId && (
          <motion.div
            {...menuPanelMotion}
            role="menu"
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-full z-40 mt-2 w-80"
          >
            <DropdownShell className="p-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0c82f2]/10 text-[#0c82f2]">
                <IconLink size={16} stroke={2} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
                  Anyone with the link
                </span>
                <span className="text-[11.5px] leading-4 text-neutral-500 dark:text-neutral-400">
                  Can view this conversation, its documents, and visualizations.
                </span>
              </div>
            </div>

            <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-black/[0.08] bg-black/[0.02] px-2.5 py-1.5 dark:border-white/[0.08] dark:bg-white/[0.02]">
              <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-600 dark:text-neutral-300">
                {shareUrl(effectiveShareId)}
              </span>
              <button
                type="button"
                onClick={copyLink}
                aria-label="Copy share link"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
              >
                {copied ? (
                  <IconCircleCheckFilled
                    size={15}
                    stroke={2}
                    className="text-emerald-500"
                  />
                ) : (
                  <IconCopy size={15} stroke={2} />
                )}
              </button>
            </div>

            <a
              href={shareRawUrl(effectiveShareId)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                capture(ANALYTICS_EVENTS.threadShareRawOpened, {
                  thread_id: threadId,
                })
              }
              className="mt-2 flex w-full items-center gap-2.5 rounded-lg border border-black/[0.08] bg-black/[0.02] px-2.5 py-2 text-left transition-colors hover:bg-black/[0.05] dark:border-white/[0.08] dark:bg-white/[0.02] dark:hover:bg-white/[0.06]"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-neutral-600 dark:bg-white/[0.06] dark:text-neutral-300">
                <IconMarkdown size={15} stroke={2} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100">
                  View raw content
                </span>
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  The whole conversation as plain markdown
                </span>
              </span>
              <IconArrowUpRight
                size={14}
                stroke={2}
                className="shrink-0 text-neutral-400 dark:text-neutral-500"
              />
            </a>

            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={stopSharing}
                className="rounded-md px-2 py-1 text-[12px] font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
              >
                Stop sharing
              </button>
              <a
                href={shareUrl(effectiveShareId)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-[#0c82f2] transition-colors hover:bg-[#0c82f2]/10"
              >
                Open
                <IconArrowUpRight size={13} stroke={2.5} />
              </a>
            </div>
            </DropdownShell>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmOpen}
        title="Share this thread?"
        message={
          <>
            A public link will be created for{" "}
            <span className="font-medium text-neutral-700 dark:text-neutral-200">
              {threadTitle.trim() || "this conversation"}
            </span>
            . Anyone with the link can view the conversation, including its
            documents and visualizations. You can stop sharing anytime.
          </>
        }
        confirmLabel="Create link"
        cancelLabel="Cancel"
        onConfirm={() => void createShare()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
