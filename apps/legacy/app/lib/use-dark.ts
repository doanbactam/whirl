import { useEffect, useState } from "react";

/** Read the current dark state from the root element's class (see lib/theme). */
function readDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

/**
 * Tracks whether the app is in dark mode by observing the `dark` class on
 * <html> — the single source of truth that lib/theme toggles (manual pref or
 * the system media query). Source-agnostic, so it catches every theme change.
 * Used to theme the sandboxed HTML iframes to match the app.
 */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(readDark);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return dark;
}
