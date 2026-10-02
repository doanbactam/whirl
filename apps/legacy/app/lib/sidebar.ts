const COLLAPSED_STORAGE_KEY = "sidebar-collapsed";
const WIDTH_STORAGE_KEY = "sidebar-width";

/** Default expanded width — matches previous `w-64` (16rem). */
export const SIDEBAR_DEFAULT_WIDTH = 256;
export const SIDEBAR_COLLAPSED_WIDTH = 52;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 440;
export const SIDEBAR_SNAP_THRESHOLD = 14;

export function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore
  }
}

export function readSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (raw == null) return SIDEBAR_DEFAULT_WIDTH;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT_WIDTH;
    return clampSidebarWidth(parsed);
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

export function setSidebarWidth(width: number) {
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)));
  } catch {
    // ignore
  }
}

/** Snap to default width when close; otherwise clamp to min/max. */
export function snapSidebarWidth(width: number): number {
  const clamped = clampSidebarWidth(width);
  if (Math.abs(clamped - SIDEBAR_DEFAULT_WIDTH) <= SIDEBAR_SNAP_THRESHOLD) {
    return SIDEBAR_DEFAULT_WIDTH;
  }
  return clamped;
}
