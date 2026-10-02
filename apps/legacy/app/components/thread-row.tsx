import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  IconArrowLeft,
  IconCheck,
  IconChevronRight,
  IconDots,
  IconFolderFilled,
  IconFolderMinus,
  IconFolderPlus,
  IconFolderSymlink,
  IconGitBranch,
  IconPencil,
  IconPin,
  IconPinFilled,
  IconTrash,
} from "@tabler/icons-react";

import { useHoverPillContext } from "~/components/hover-pill";
import { RenameModal } from "~/components/rename-modal";
import { Spinner } from "~/components/spinner";
import { ThreadActionsSheet } from "~/components/thread-actions-sheet";
import {
  DropdownShell,
  dropdownItemCompactClass,
} from "~/components/dropdown-menu";
import { useFolderActions, useFolders } from "~/data/folders";
import { useThreadActions, type Thread } from "~/data/threads";
import {
  beginThreadDrag,
  endThreadDrag,
  THREAD_DRAG_TYPE,
} from "~/lib/folders";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";
import { useMinMd } from "~/lib/use-media";

const MENU_EASE = [0.22, 0.61, 0.36, 1] as const;
const MENU_WIDTH_MAIN = 192;
const MENU_WIDTH_FOLDERS = 224;

// Direction-aware slide for the main ↔ folder-picker morph: the incoming view
// pushes in from the side the user is heading toward, the outgoing one keeps
// travelling the same way.
const menuViewVariants = {
  enter: (direction: number) => ({ x: direction * 28, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction * -28, opacity: 0 }),
};

function ThreadTitleSkeleton() {
  return (
    <span
      aria-label="Generating title"
      className="relative inline-flex h-3.5 w-32 overflow-hidden rounded-md bg-black/[0.06] dark:bg-white/[0.06]"
    >
      <span
        aria-hidden
        className="absolute inset-0 animate-rainbow bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.55)_50%,transparent_100%)] bg-[length:200%_100%] dark:bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.18)_50%,transparent_100%)]"
      />
    </span>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className={`${dropdownItemCompactClass} ${
        destructive
          ? "text-red-600 hover:bg-red-500/10 dark:text-red-400"
          : ""
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

export function ThreadRow({
  thread,
  onOpen,
  layout = "sidebar",
}: {
  thread: Thread;
  onOpen: () => void;
  layout?: "sidebar" | "page";
}) {
  const minMd = useMinMd();
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [flip, setFlip] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  // "folders" swaps the dropdown to the move-to-folder picker in place — the
  // sidebar is too narrow for a flyout submenu to live beside it.
  const [menuView, setMenuView] = useState<"main" | "folders">("main");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  // Measured height of the active menu view, so the dropdown shell can morph
  // between the two views instead of snapping.
  const [menuHeight, setMenuHeight] = useState<number | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const { renameThread, deleteThread, setPinned, setFolder } =
    useThreadActions();
  const folders = useFolders();
  const { createFolder } = useFolderActions();
  const capture = useCapture();
  const isPinned = thread.pinnedAt != null;
  const navigate = useNavigate();
  const location = useLocation();
  const isCurrent = location.pathname === `/thread/${thread.id}`;
  const isPageLayout = layout === "page";
  // In the sidebar the row's hover feedback is the shared hover pill (see
  // hover-pill.tsx); outside a provider (e.g. the /threads page) it stays the
  // plain CSS hover.
  const sharedPill = useHoverPillContext();
  const pill = isPageLayout ? null : sharedPill;
  const pillKey = `thread-${thread.id}`;

  // If the row disappears while hovered (thread deleted, refiled), don't
  // leave the pill stranded on nothing.
  useEffect(() => {
    if (!pill) return;
    return () => pill.onLeave(pillKey, true);
  }, [pill, pillKey]);

  const openMenu = () => {
    if (!minMd) {
      setSheetOpen(true);
      return;
    }
    const anchor = triggerRef.current ?? rowRef.current;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      setFlip(window.innerHeight - rect.bottom < 160);
    }
    setMenuView("main");
    setMenuHeight(null);
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const el = viewRef.current;
    if (el) setMenuHeight(el.offsetHeight);
  }, [open, menuView, folders.length, thread.folderId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const startRename = () => {
    setRenameOpen(true);
    setOpen(false);
    setSheetOpen(false);
  };

  const handleDelete = () => {
    setOpen(false);
    setSheetOpen(false);
    if (isCurrent) void navigate({ to: "/" });
    deleteThread(thread.id, thread.title);
  };

  const handlePin = () => {
    void setPinned(thread.id, !isPinned);
  };

  const handleMoveToFolder = (folderId: string | null) => {
    setOpen(false);
    void setFolder(thread.id, folderId);
  };

  const handleCreateFolderAndMove = async (name: string) => {
    const folderId = await createFolder(name);
    if (folderId) await setFolder(thread.id, folderId);
  };

  const handleOpen = () => {
    capture(ANALYTICS_EVENTS.threadOpened, {
      thread_id: thread.id,
      source: isPageLayout ? "threads_page" : "sidebar",
      pinned: isPinned,
    });
    onOpen();
  };

  // Whole-row drag (desktop sidebar only): rows can be dropped onto a sidebar
  // folder to file them. The deferred state flip keeps the browser's drag
  // ghost from snapshotting the row already dimmed.
  const canDrag = minMd && !isPageLayout;
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(THREAD_DRAG_TYPE, thread.id);
    e.dataTransfer.effectAllowed = "move";
    beginThreadDrag({ threadId: thread.id, folderId: thread.folderId });
    pill?.onLeave(pillKey, true);
    setTimeout(() => setDragging(true), 0);
  };
  const handleDragEnd = () => {
    endThreadDrag();
    setDragging(false);
  };

  return (
    <div
      ref={rowRef}
      draggable={canDrag || undefined}
      onDragStart={canDrag ? handleDragStart : undefined}
      onDragEnd={canDrag ? handleDragEnd : undefined}
      onMouseEnter={pill ? (e) => pill.onHover(pillKey, e.currentTarget) : undefined}
      onMouseLeave={pill ? () => pill.onLeave(pillKey) : undefined}
      className={`group/row relative transition-opacity ${dragging ? "opacity-40" : ""}`}
    >
      <button
        type="button"
        onClick={handleOpen}
        onDoubleClick={minMd ? startRename : undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          if (open) setOpen(false);
          else openMenu();
        }}
        className={`relative flex w-full items-center rounded-xl text-left transition-colors ${
          pill
            ? ""
            : "group-hover/row:bg-[#E0E0E0] dark:group-hover/row:bg-[#1E1E1E]"
        } ${
          isPageLayout
            ? "min-h-12 px-3 pr-14 py-3 text-[15px] max-md:active:bg-[#E0E0E0] dark:max-md:active:bg-[#1E1E1E]"
            : "h-9 pl-3 pr-9 text-[13px]"
        } ${
          isCurrent
            ? "text-neutral-900 dark:text-neutral-50"
            : "text-neutral-700 dark:text-neutral-300"
        }`}
      >
        {/* The active-thread fill lives on its own layer so it can squish on
            press like the hover pill does — a bg on the button itself can't. */}
        {isCurrent && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-xl bg-[#E0E0E0] transition-[scale] duration-150 ease-out group-active/row:scale-[0.97] dark:bg-[#1E1E1E]"
          />
        )}
        <span className="relative flex min-w-0 flex-1 items-center gap-2">
          {thread.running && (
            <Spinner
              size={isPageLayout ? 13 : 12}
              className="text-[#0c82f2] dark:text-[#3b9bff]"
            />
          )}
          {thread.branchedFromThreadId && (
            <IconGitBranch
              size={isPageLayout ? 14 : 12}
              stroke={2}
              aria-label="Branched thread"
              className="shrink-0 text-neutral-400 dark:text-neutral-500"
            />
          )}
          {thread.titleStatus === "generating" ? (
            <ThreadTitleSkeleton />
          ) : (
            <span className="min-w-0 flex-1 truncate">{thread.title}</span>
          )}
          {isPinned && (
            <IconPinFilled
              size={isPageLayout ? 14 : 12}
              stroke={2}
              className="shrink-0 rotate-45 text-neutral-400 dark:text-neutral-500"
            />
          )}
        </span>
      </button>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!minMd) {
            setSheetOpen(true);
            return;
          }
          if (open) setOpen(false);
          else openMenu();
        }}
        aria-label="Thread actions"
        aria-haspopup={minMd ? "menu" : "dialog"}
        aria-expanded={minMd ? open : sheetOpen}
        className={`absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-xl text-neutral-500 transition-opacity dark:text-neutral-400 ${
          isPageLayout ? "h-10 w-10 max-md:opacity-100" : "h-7 w-7"
        } ${
          open || sheetOpen
            ? "bg-black/10 opacity-100 dark:bg-white/10"
            : isPageLayout
              ? "opacity-70 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
              : "opacity-0 hover:bg-black/10 group-hover/row:opacity-100 max-md:opacity-100 dark:hover:bg-white/10"
        }`}
      >
        <IconDots size={isPageLayout ? 18 : 16} stroke={2} />
      </button>
      <RenameModal
        open={renameOpen}
        initialTitle={thread.title}
        onClose={() => setRenameOpen(false)}
        onSubmit={(title) => renameThread(thread.id, title)}
      />
      <ThreadActionsSheet
        open={sheetOpen}
        threadTitle={thread.title}
        isPinned={isPinned}
        onClose={() => setSheetOpen(false)}
        onPin={handlePin}
        onRename={startRename}
        onDelete={handleDelete}
      />
      <AnimatePresence>
        {open && minMd && (
          <motion.div
            ref={menuRef}
            role="menu"
            initial={{ opacity: 0, y: flip ? 3 : -3, width: MENU_WIDTH_MAIN }}
            animate={{
              opacity: 1,
              y: 0,
              width:
                menuView === "folders" ? MENU_WIDTH_FOLDERS : MENU_WIDTH_MAIN,
            }}
            exit={{ opacity: 0, y: flip ? 3 : -3 }}
            transition={{
              duration: 0.1,
              ease: MENU_EASE,
              width: { duration: 0.2, ease: MENU_EASE },
            }}
            className={`absolute right-1 z-20 ${flip ? "bottom-full mb-1" : "top-full mt-1"}`}
          >
            <DropdownShell subtle>
            <motion.div
              animate={menuHeight != null ? { height: menuHeight } : undefined}
              transition={{ duration: 0.2, ease: MENU_EASE }}
              className="relative overflow-hidden"
            >
            <AnimatePresence
              mode="popLayout"
              initial={false}
              custom={menuView === "folders" ? 1 : -1}
            >
            <motion.div
              key={menuView}
              ref={viewRef}
              custom={menuView === "folders" ? 1 : -1}
              variants={menuViewVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.18, ease: MENU_EASE }}
            >
            {menuView === "main" ? (
              <>
                <MenuItem
                  icon={<IconPin size={14} stroke={2} />}
                  onClick={() => {
                    setOpen(false);
                    handlePin();
                  }}
                >
                  {isPinned ? "Unpin" : "Pin"}
                </MenuItem>
                <MenuItem
                  icon={<IconFolderSymlink size={14} stroke={2} />}
                  onClick={() => setMenuView("folders")}
                >
                  <span className="flex-1">Move to folder</span>
                  <IconChevronRight
                    size={14}
                    stroke={2}
                    className="text-neutral-500"
                  />
                </MenuItem>
                <MenuItem
                  icon={<IconPencil size={14} stroke={2} />}
                  onClick={startRename}
                >
                  Rename
                </MenuItem>
                <MenuItem
                  icon={<IconTrash size={14} stroke={2} />}
                  onClick={handleDelete}
                  destructive
                >
                  Delete
                </MenuItem>
              </>
            ) : (
              <>
                <MenuItem
                  icon={<IconArrowLeft size={14} stroke={2} />}
                  onClick={() => setMenuView("main")}
                >
                  <span className="text-neutral-500 dark:text-neutral-400">
                    Move to folder
                  </span>
                </MenuItem>
                <div className="my-1 h-px bg-black/[0.06] dark:bg-white/[0.06]" />
                {folders.length > 0 && (
                  <div className="max-h-56 overflow-y-auto">
                    {folders.map((folder) => {
                      const isCurrentFolder = thread.folderId === folder.id;
                      return (
                        <MenuItem
                          key={folder.id}
                          icon={<IconFolderFilled size={14} />}
                          onClick={() =>
                            handleMoveToFolder(
                              isCurrentFolder ? null : folder.id,
                            )
                          }
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {folder.name}
                          </span>
                          {isCurrentFolder && (
                            <IconCheck
                              size={14}
                              stroke={2.5}
                              className="shrink-0 text-[#0c82f2]"
                            />
                          )}
                        </MenuItem>
                      );
                    })}
                  </div>
                )}
                {thread.folderId != null && (
                  <MenuItem
                    icon={<IconFolderMinus size={14} stroke={2} />}
                    onClick={() => handleMoveToFolder(null)}
                  >
                    Remove from folder
                  </MenuItem>
                )}
                {folders.length > 0 && (
                  <div className="my-1 h-px bg-black/[0.06] dark:bg-white/[0.06]" />
                )}
                <MenuItem
                  icon={<IconFolderPlus size={14} stroke={2} />}
                  onClick={() => {
                    setOpen(false);
                    setNewFolderOpen(true);
                  }}
                >
                  New folder…
                </MenuItem>
              </>
            )}
            </motion.div>
            </AnimatePresence>
            </motion.div>
            </DropdownShell>
          </motion.div>
        )}
      </AnimatePresence>
      <RenameModal
        open={newFolderOpen}
        initialTitle=""
        label="New folder"
        placeholder="Folder name"
        submitLabel="Create"
        onClose={() => setNewFolderOpen(false)}
        onSubmit={(name) => void handleCreateFolderAndMove(name)}
      />
    </div>
  );
}
