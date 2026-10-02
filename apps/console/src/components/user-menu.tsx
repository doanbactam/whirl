import { useEffect, useRef, useState } from "react";
import { useClerk, useUser } from "@clerk/clerk-react";
import { AnimatePresence, motion } from "motion/react";
import { IconChevronDown, IconLogout } from "@tabler/icons-react";

import { Skeleton } from "~/components/skeleton";
import { CONSOLE_EVENTS, useCapture } from "~/lib/analytics";

/** The signed-in developer chip in the top bar, with a small sign-out menu. */
export function UserMenu() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const capture = useCapture();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
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

  if (!isLoaded) {
    return <Skeleton className="h-8 w-8 rounded-full" />;
  }
  if (!user) return null;

  const displayName =
    user.firstName ||
    user.fullName ||
    user.username ||
    user.primaryEmailAddress?.emailAddress ||
    "Account";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-9 items-center gap-2 rounded-xl px-1.5 transition-colors ${
          open
            ? "bg-[#E0E0E0] dark:bg-[#1E1E1E]"
            : "hover:bg-[#E0E0E0] dark:hover:bg-[#1E1E1E]"
        }`}
      >
        {user.imageUrl ? (
          <img
            src={user.imageUrl}
            alt={displayName}
            className="h-7 w-7 rounded-full object-cover"
          />
        ) : (
          <span className="h-7 w-7 rounded-full border border-neutral-400 dark:border-neutral-600" />
        )}
        <IconChevronDown
          size={13}
          stroke={2}
          className={`text-neutral-500 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12, ease: [0.22, 0.61, 0.36, 1] }}
            className="absolute top-full right-0 z-50 mt-1.5 w-56 rounded-xl border border-black/[0.06] bg-white p-1 shadow-xl dark:border-white/[0.08] dark:bg-[#1B1B1B]"
          >
            <div className="px-2.5 pt-2 pb-2.5">
              <div className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                {displayName}
              </div>
              <div className="truncate text-[11.5px] text-neutral-500 dark:text-neutral-400">
                {user.primaryEmailAddress?.emailAddress}
              </div>
            </div>
            <div className="mx-1 h-px bg-black/[0.06] dark:bg-white/[0.08]" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                capture(CONSOLE_EVENTS.signedOut);
                void signOut();
              }}
              className="mt-1 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] text-neutral-700 transition-colors hover:bg-black/[0.05] dark:text-neutral-200 dark:hover:bg-white/[0.06]"
            >
              <IconLogout size={14} stroke={2} />
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
