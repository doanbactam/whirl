import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { makeFunctionReference } from "convex/server";
import { useConvexAuth, useMutation } from "convex/react";

import { ConfirmDialog } from "~/components/confirm-dialog";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

const purgeIncognitoRef = makeFunctionReference<"mutation">(
  "threads:purgeIncognito",
);

type IncognitoContextValue = {
  /** Whether incognito mode is currently on. */
  enabled: boolean;
  /** The live ephemeral thread, once the first message has created it. */
  threadId: string | null;
  /** Turn incognito on (scrubs any leftover ephemeral threads first). */
  enter: () => void;
  /** Ask to leave — confirms first when there's a chat that would be lost. */
  requestExit: () => void;
  /** Latch the ephemeral thread id after the first send. */
  setThreadId: (id: string) => void;
};

const IncognitoContext = createContext<IncognitoContextValue | null>(null);

export function IncognitoProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const capture = useCapture();
  const purgeIncognito = useMutation(purgeIncognitoRef);

  const [enabled, setEnabled] = useState(false);
  const [threadId, setThreadIdState] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Convex hands back a fresh mutation identity (and useCapture a fresh closure)
  // every render. Keep them in refs so the callbacks below stay stable and the
  // context value doesn't churn the whole shell on each render.
  const purgeRef = useRef(purgeIncognito);
  purgeRef.current = purgeIncognito;
  const captureRef = useRef(capture);
  captureRef.current = capture;

  // Belt-and-braces: on every authenticated load, scrub any incognito thread an
  // earlier session left behind (e.g. a hard refresh mid-chat). They're never
  // meant to outlive the tab, so this guarantees a clean slate.
  useEffect(() => {
    if (!isAuthenticated) return;
    void purgeRef.current({}).catch(() => {});
  }, [isAuthenticated]);

  const setThreadId = useCallback((id: string) => {
    setThreadIdState(id);
  }, []);

  const enter = useCallback(() => {
    void purgeRef.current({}).catch(() => {});
    setThreadIdState(null);
    setEnabled(true);
    captureRef.current(ANALYTICS_EVENTS.incognitoEntered);
  }, []);

  const leave = useCallback((purgeThread: string | null) => {
    setConfirmOpen(false);
    setEnabled(false);
    setThreadIdState(null);
    if (purgeThread) {
      void purgeRef.current({ threadId: purgeThread }).catch(() => {});
    }
    captureRef.current(ANALYTICS_EVENTS.incognitoExited, {
      had_chat: Boolean(purgeThread),
    });
  }, []);

  const requestExit = useCallback(() => {
    // Nothing typed yet → leave instantly. A live chat → confirm first, since
    // leaving permanently deletes it.
    if (threadId) setConfirmOpen(true);
    else leave(null);
  }, [threadId, leave]);

  const value = useMemo<IncognitoContextValue>(
    () => ({ enabled, threadId, enter, requestExit, setThreadId }),
    [enabled, threadId, enter, requestExit, setThreadId],
  );

  return (
    <IncognitoContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={confirmOpen}
        title="Leave incognito?"
        message="This chat was never saved — leaving deletes it for good, with no way to get it back."
        confirmLabel="Leave & delete"
        cancelLabel="Stay"
        tone="danger"
        onConfirm={() => leave(threadId)}
        onCancel={() => setConfirmOpen(false)}
      />
    </IncognitoContext.Provider>
  );
}

export function useIncognito(): IncognitoContextValue {
  const ctx = useContext(IncognitoContext);
  if (!ctx) {
    throw new Error("useIncognito must be used within an IncognitoProvider");
  }
  return ctx;
}
