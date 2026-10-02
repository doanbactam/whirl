import { useNavigate } from "@tanstack/react-router";
import { motion, type Variants } from "motion/react";
import { createFileRoute } from "@tanstack/react-router";
import { IconAlertTriangle, IconReload } from "@tabler/icons-react";

import { ThreadRow } from "~/components/thread-row";
import { Spinner } from "~/components/spinner";
import {
  groupThreads,
  useThreads,
  useThreadsError,
  useThreadsLoading,
} from "~/data/threads";

export const Route = createFileRoute("/threads")({
  component: ThreadsPage,
  head: () => ({
    meta: [{ title: "Threads · Whirl" }],
  }),
});

const threadsStagger: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05 },
  },
};

const threadGroupItem: Variants = {
  hidden: { opacity: 0, y: 4 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.22, 0.61, 0.36, 1] },
  },
};

function ThreadsPage() {
  const navigate = useNavigate();
  const threads = useThreads();
  const threadsLoading = useThreadsLoading();
  const threadsError = useThreadsError();
  const groupedThreads = groupThreads(threads);

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-black/[0.06] px-4 py-4 dark:border-white/[0.06]">
        <h1 className="text-[17px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Threads
        </h1>
        <p className="mt-1 text-[13px] leading-snug text-neutral-500 dark:text-neutral-400 md:hidden">
          Tap a chat to open it, or use ··· for pin, rename, and delete.
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 max-md:px-1">
        {threadsLoading ? (
          <div className="flex items-center justify-center py-12 text-neutral-400 dark:text-neutral-500">
            <Spinner size={18} className="text-blue-500" />
          </div>
        ) : threadsError ? (
          <div className="mx-2 flex flex-col items-start gap-2 rounded-xl bg-red-500/[0.06] p-4 dark:bg-red-500/[0.12]">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-red-700 dark:text-red-300">
              <IconAlertTriangle size={14} stroke={2.5} />
              Couldn't load chats
            </span>
            <p className="text-[12px] leading-4 text-red-700/80 dark:text-red-300/80">
              {threadsError.message || "Check your connection and try again."}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex h-8 items-center gap-1 rounded-full bg-red-500/10 px-3 text-[12px] font-medium text-red-700 transition-colors hover:bg-red-500/15 dark:bg-red-500/20 dark:text-red-200"
            >
              <IconReload size={13} stroke={2.5} />
              Try again
            </button>
          </div>
        ) : groupedThreads.length === 0 ? (
          <p className="px-4 py-12 text-center text-[14px] text-neutral-500 dark:text-neutral-400">
            No conversations yet. Start a new chat from the + button.
          </p>
        ) : (
          <motion.div
            variants={threadsStagger}
            initial="hidden"
            animate="show"
            className="flex flex-col gap-6 max-md:gap-5"
          >
            {groupedThreads.map(([group, items]) => (
              <motion.div
                variants={threadGroupItem}
                key={group}
                className="flex flex-col gap-0.5"
              >
                <span className="flex h-8 items-center px-3 text-[12px] font-medium tracking-wide text-neutral-400 max-md:px-4 dark:text-neutral-500">
                  {group}
                </span>
                {items.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    layout="page"
                    thread={thread}
                    onOpen={() => {
                      void navigate({ to: `/thread/${thread.id}` });
                    }}
                  />
                ))}
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
