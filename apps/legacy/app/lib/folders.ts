const COLLAPSED_FOLDERS_KEY = "sidebar-folders-collapsed";

/**
 * DataTransfer MIME type carrying a thread id while a sidebar thread row is
 * being dragged, so folder rows can recognize (and accept) the drop.
 */
export const THREAD_DRAG_TYPE = "application/x-hyde-thread-id";

export type ThreadDragPayload = { threadId: string; folderId: string | null };

// dataTransfer payloads are unreadable during dragover, so drop targets read
// the in-flight thread from here instead (set on dragstart, cleared on
// dragend). Lets folders skip highlighting their own threads and lets the
// loose area know whether a drop would actually unfile anything.
let currentThreadDrag: ThreadDragPayload | null = null;

export function beginThreadDrag(payload: ThreadDragPayload) {
  currentThreadDrag = payload;
}

export function endThreadDrag() {
  currentThreadDrag = null;
}

export function getThreadDrag(): ThreadDragPayload | null {
  return currentThreadDrag;
}

/**
 * Which sidebar folders the user has collapsed, persisted locally (like the
 * sidebar width/collapsed prefs) — purely a view preference, so it never
 * touches the backend. Stored as a JSON array of folder ids.
 */
export function readCollapsedFolders(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_FOLDERS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function persistCollapsedFolders(collapsed: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([...collapsed]));
  } catch {
    // ignore
  }
}
