import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  AnimatePresence,
  motion,
  Reorder,
  useDragControls,
} from "motion/react";
import {
  IconChevronRight,
  IconDots,
  IconFolderFilled,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";

import { ConfirmDialog } from "~/components/confirm-dialog";
import { useHoverPillContext } from "~/components/hover-pill";
import { RenameModal } from "~/components/rename-modal";
import { ThreadRow } from "~/components/thread-row";
import {
  DropdownShell,
  dropdownItemCompactClass,
} from "~/components/dropdown-menu";
import { useFolderActions, type Folder } from "~/data/folders";
import { useThreadActions, type Thread } from "~/data/threads";
import {
  getThreadDrag,
  persistCollapsedFolders,
  readCollapsedFolders,
  THREAD_DRAG_TYPE,
} from "~/lib/folders";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

function hasThreadDrag(e: DragEvent) {
  return e.dataTransfer.types.includes(THREAD_DRAG_TYPE);
}

/**
 * User-created folders at the top of the sidebar's thread list, each
 * collapsible. Grab a folder row to reorder; drop a thread row onto a folder
 * to file it. Membership is also editable from each thread's ⋯ menu
 * ("Move to folder"), which is where the first folder gets created.
 */
export function FolderSection({
  folders,
  threadsByFolder,
  onOpenThread,
}: {
  folders: Folder[];
  threadsByFolder: Map<string, Thread[]>;
  onOpenThread: (thread: Thread) => void;
}) {
  const capture = useCapture();
  const { reorderFolders } = useFolderActions();
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsedFolders);

  // Local mirror of the folder order so a drag re-sorts instantly; synced back
  // from the server list whenever it actually changes (create/delete/commit).
  const serverOrderKey = folders.map((f) => f.id).join("|");
  const [order, setOrder] = useState<string[]>(() => folders.map((f) => f.id));
  const orderRef = useRef(order);
  orderRef.current = order;
  useEffect(() => {
    setOrder(serverOrderKey ? serverOrderKey.split("|") : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverOrderKey]);

  const foldersById = new Map(folders.map((f) => [f.id, f]));
  const displayFolders = order
    .map((id) => foldersById.get(id))
    .filter((f): f is Folder => f !== undefined);

  const toggleCollapsed = (folderId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      const nowCollapsed = !next.has(folderId);
      if (nowCollapsed) next.add(folderId);
      else next.delete(folderId);
      persistCollapsedFolders(next);
      capture(ANALYTICS_EVENTS.folderToggled, {
        folder_id: folderId,
        collapsed: nowCollapsed,
      });
      return next;
    });
  };

  return (
    <Reorder.Group
      as="div"
      axis="y"
      values={order}
      onReorder={setOrder}
      className="flex flex-col gap-0.5"
    >
      {displayFolders.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          threads={threadsByFolder.get(folder.id) ?? []}
          expanded={!collapsed.has(folder.id)}
          onToggle={() => toggleCollapsed(folder.id)}
          onDragCommit={() => void reorderFolders(orderRef.current)}
          onOpenThread={onOpenThread}
        />
      ))}
    </Reorder.Group>
  );
}

function FolderRow({
  folder,
  threads,
  expanded,
  onToggle,
  onDragCommit,
  onOpenThread,
}: {
  folder: Folder;
  threads: Thread[];
  expanded: boolean;
  onToggle: () => void;
  onDragCommit: () => void;
  onOpenThread: (thread: Thread) => void;
}) {
  const { renameFolder, deleteFolder } = useFolderActions();
  const { setFolder } = useThreadActions();
  const dragControls = useDragControls();
  // Hover feedback is the sidebar's shared hover pill (see hover-pill.tsx);
  // outside a provider the header keeps its plain CSS hover.
  const pill = useHoverPillContext();
  const pillKey = `folder-${folder.id}`;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuFlip, setMenuFlip] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Overflow must be hidden while the folder animates open/closed (that's what
  // clips the sliding content), but once settled open it has to be visible or
  // the thread rows' dropdown menus get cut off at the folder's edge.
  const [overflowVisible, setOverflowVisible] = useState(expanded);
  useEffect(() => {
    if (!expanded) setOverflowVisible(false);
  }, [expanded]);
  // A thread row is hovering over the header, ready to drop in.
  const [dropActive, setDropActive] = useState(false);

  // The drop highlight replaces hover feedback, and a vanished header
  // (folder deleted) shouldn't strand the pill.
  useEffect(() => {
    if (dropActive) pill?.onLeave(pillKey, true);
  }, [dropActive, pill, pillKey]);
  useEffect(() => {
    if (!pill) return;
    return () => pill.onLeave(pillKey, true);
  }, [pill, pillKey]);
  const dropDepthRef = useRef(0);
  // Swallows the click that fires right after a reorder drag ends, so letting
  // go of a dragged folder doesn't also toggle it.
  const didDragRef = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !menuTriggerRef.current?.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const openMenu = () => {
    const anchor = menuTriggerRef.current;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      setMenuFlip(window.innerHeight - rect.bottom < 120);
    }
    setMenuOpen(true);
  };

  // Cancelled drags (Escape) don't always fire a final dragleave, so clear the
  // highlight whenever the drag ends anywhere.
  useEffect(() => {
    if (!dropActive) return;
    const clear = () => {
      dropDepthRef.current = 0;
      setDropActive(false);
    };
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [dropActive]);

  // A thread drag from this very folder is a no-op: don't light up, and stop
  // the events so the sidebar's unfile zone underneath doesn't claim them.
  const acceptsDrag = () => {
    const drag = getThreadDrag();
    return drag != null && drag.folderId !== folder.id;
  };

  return (
    <Reorder.Item
      as="div"
      value={folder.id}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={() => {
        setDragging(true);
        didDragRef.current = true;
        pill?.onLeave(pillKey, true);
      }}
      onDragEnd={() => {
        setDragging(false);
        onDragCommit();
        requestAnimationFrame(() => {
          didDragRef.current = false;
        });
      }}
      className={`relative rounded-xl ${
        dragging
          ? "z-30 bg-[#E9E9E9] shadow-[0_6px_18px_rgba(0,0,0,0.12)] dark:bg-[#1C1C1C] dark:shadow-[0_6px_18px_rgba(0,0,0,0.5)]"
          : ""
      }`}
    >
      {/* The whole block — header and, when expanded, the open thread list —
          is one drop zone, so threads can land anywhere on the folder. */}
      <div
        className={`rounded-xl transition-[background-color,box-shadow] ${
          dropActive
            ? "bg-[#0c82f2]/10 ring-1 ring-inset ring-[#0c82f2]/35 dark:bg-[#3b9bff]/15 dark:ring-[#3b9bff]/35"
            : ""
        }`}
        onDragEnter={(e) => {
          if (!hasThreadDrag(e)) return;
          e.stopPropagation();
          if (!acceptsDrag()) return;
          e.preventDefault();
          dropDepthRef.current += 1;
          setDropActive(true);
        }}
        onDragOver={(e) => {
          if (!hasThreadDrag(e)) return;
          e.stopPropagation();
          if (!acceptsDrag()) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDragLeave={(e) => {
          if (!hasThreadDrag(e)) return;
          e.stopPropagation();
          dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
          if (dropDepthRef.current === 0) setDropActive(false);
        }}
        onDrop={(e) => {
          if (!hasThreadDrag(e)) return;
          e.stopPropagation();
          e.preventDefault();
          dropDepthRef.current = 0;
          setDropActive(false);
          const drag = getThreadDrag();
          const threadId =
            drag?.threadId ?? e.dataTransfer.getData(THREAD_DRAG_TYPE);
          if (!threadId || threads.some((t) => t.id === threadId)) return;
          void setFolder(threadId, folder.id, "drag");
        }}
      >
      <div
        className="group/folder relative"
        onMouseEnter={
          pill ? (e) => pill.onHover(pillKey, e.currentTarget) : undefined
        }
        onMouseLeave={pill ? () => pill.onLeave(pillKey) : undefined}
      >
        <button
          type="button"
          onClick={() => {
            if (didDragRef.current) {
              didDragRef.current = false;
              return;
            }
            onToggle();
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            dragControls.start(e);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (menuOpen) setMenuOpen(false);
            else openMenu();
          }}
          aria-expanded={expanded}
          className={`relative flex h-9 w-full items-center rounded-xl pl-3 pr-9 text-left text-[13px] font-medium text-neutral-700 transition-colors dark:text-neutral-300 ${
            dropActive || pill
              ? ""
              : "group-hover/folder:bg-[#E0E0E0] dark:group-hover/folder:bg-[#1E1E1E]"
          }`}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <IconChevronRight
              size={12}
              stroke={2.5}
              className={`shrink-0 text-neutral-400 transition-transform duration-200 dark:text-neutral-500 ${
                expanded ? "rotate-90" : ""
              }`}
            />
            <IconFolderFilled
              size={14}
              className={`shrink-0 transition-colors ${
                dropActive
                  ? "text-[#0c82f2] dark:text-[#3b9bff]"
                  : "text-neutral-400 dark:text-neutral-500"
              }`}
            />
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            {threads.length > 0 && (
              <span className="shrink-0 text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
                {threads.length}
              </span>
            )}
          </span>
        </button>
        <button
          ref={menuTriggerRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (menuOpen) setMenuOpen(false);
            else openMenu();
          }}
          aria-label="Folder actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={`absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-xl text-neutral-500 transition-opacity dark:text-neutral-400 ${
            menuOpen
              ? "bg-black/10 opacity-100 dark:bg-white/10"
              : "opacity-0 hover:bg-black/10 group-hover/folder:opacity-100 dark:hover:bg-white/10"
          }`}
        >
          <IconDots size={16} stroke={2} />
        </button>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              ref={menuRef}
              role="menu"
              initial={{ opacity: 0, y: menuFlip ? 3 : -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: menuFlip ? 3 : -3 }}
              transition={{ duration: 0.1, ease: [0.22, 0.61, 0.36, 1] }}
              className={`absolute right-1 z-20 w-40 ${
                menuFlip ? "bottom-full mb-1" : "top-full mt-1"
              }`}
            >
              <DropdownShell subtle>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setRenameOpen(true);
                  }}
                  className={dropdownItemCompactClass}
                >
                  <IconPencil size={14} stroke={2} />
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setDeleteOpen(true);
                  }}
                  className={`${dropdownItemCompactClass} text-red-600 hover:bg-red-500/10 dark:text-red-400`}
                >
                  <IconTrash size={14} stroke={2} />
                  Delete
                </button>
              </DropdownShell>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <motion.div
        initial={false}
        animate={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
        }}
        transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
        onAnimationComplete={() => {
          if (expanded) setOverflowVisible(true);
        }}
        className="grid"
        aria-hidden={!expanded}
        style={{ pointerEvents: expanded ? undefined : "none" }}
      >
        <div
          className={`min-h-0 ${overflowVisible ? "" : "overflow-hidden"}`}
        >
          <div className="ml-[15px] flex flex-col gap-0.5 border-l border-black/[0.07] pl-1.5 dark:border-white/[0.08]">
            {threads.length === 0 ? (
              <span className="flex h-8 items-center px-3 text-[11.5px] text-neutral-400 dark:text-neutral-500">
                Nothing in here yet
              </span>
            ) : (
              threads.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  onOpen={() => onOpenThread(thread)}
                />
              ))
            )}
          </div>
        </div>
      </motion.div>
      </div>

      <RenameModal
        open={renameOpen}
        initialTitle={folder.name}
        label="Rename folder"
        placeholder="Folder name"
        onClose={() => setRenameOpen(false)}
        onSubmit={(name) => void renameFolder(folder.id, name)}
      />
      <ConfirmDialog
        open={deleteOpen}
        title="Delete folder?"
        message={`Chats inside "${folder.name}" won't be deleted — they'll move back to your history.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          setDeleteOpen(false);
          void deleteFolder(folder.id);
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </Reorder.Item>
  );
}
