import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth, useClerk } from "@clerk/tanstack-react-start";
import { IconLogin2, IconReload } from "@tabler/icons-react";

import { AuthModal } from "~/components/auth-modal";
import { DepthButton } from "~/components/depth-button";
import { Spinner } from "~/components/spinner";
import { WhirlLogo } from "~/components/whirl-logo";
import { isAuthError } from "~/lib/auth-errors";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

/**
 * Catches "Not authenticated" errors thrown by Convex queries (the token
 * expired or the session was revoked mid-visit) and offers a way back in,
 * instead of letting the whole app fall over into the root error page.
 * Anything that isn't an auth error is rethrown to the boundary above.
 */
export function AuthErrorBoundary({ children }: { children: ReactNode }) {
  const { isSignedIn } = useAuth();
  const [resetKey, setResetKey] = useState(0);
  // Auth errors from mutations/actions arrive as promise rejections rather
  // than render throws, so the class boundary alone would miss them.
  const [rejectionError, setRejectionError] = useState(false);
  const wasSignedOut = useRef(false);

  const reset = useCallback(() => {
    setRejectionError(false);
    setResetKey((key) => key + 1);
  }, []);

  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isAuthError(event.reason)) return;
      event.preventDefault();
      setRejectionError(true);
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  // Once a fresh session lands (the visitor signed back in), remount the app
  // so every query resubscribes with the new token.
  useEffect(() => {
    if (!isSignedIn) {
      wasSignedOut.current = true;
      return;
    }
    if (wasSignedOut.current) {
      wasSignedOut.current = false;
      reset();
    }
  }, [isSignedIn, reset]);

  if (rejectionError) {
    return <SessionExpiredScreen onRetry={reset} />;
  }

  return (
    <Boundary resetKey={resetKey} fallback={<SessionExpiredScreen onRetry={reset} />}>
      {children}
    </Boundary>
  );
}

type BoundaryProps = {
  resetKey: number;
  fallback: ReactNode;
  children: ReactNode;
};

class Boundary extends Component<BoundaryProps, { error: unknown | null }> {
  state: { error: unknown | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (error !== null) {
      if (!isAuthError(error)) throw error;
      return this.props.fallback;
    }
    return this.props.children;
  }
}

function SessionExpiredScreen({ onRetry }: { onRetry: () => void }) {
  const { signOut } = useClerk();
  const capture = useCapture();
  const [modalOpen, setModalOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    capture(ANALYTICS_EVENTS.sessionExpiredPrompted);
    // capture is stable per posthog instance; run once per prompt shown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clerk may still be holding the stale session — clear it first so the
  // sign-in flow starts clean, then let the modal take over.
  const startSignIn = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // Already signed out — the modal works either way.
    }
    setSigningOut(false);
    setModalOpen(true);
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-[#f8f8fa] px-6 text-center dark:bg-[#171718]">
      <WhirlLogo size={40} />
      <div className="flex flex-col gap-1">
        <h1 className="text-[20px] font-medium tracking-tight text-neutral-900 dark:text-neutral-50">
          Your session expired
        </h1>
        <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
          Sign in again to pick up right where you left off.
        </p>
      </div>
      <div className="flex items-center gap-2.5">
        <DepthButton
          variant="blue"
          type="button"
          onClick={() => void startSignIn()}
          disabled={signingOut}
          className="flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-medium tracking-tight text-white disabled:cursor-not-allowed disabled:opacity-70"
        >
          {signingOut ? (
            <Spinner size={14} className="text-white" />
          ) : (
            <IconLogin2 size={15} stroke={2} />
          )}
          Sign in again
        </DepthButton>
        <button
          type="button"
          onClick={() => {
            capture(ANALYTICS_EVENTS.sessionExpiredRetried);
            onRetry();
          }}
          className="flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-[13px] text-neutral-500 transition-colors hover:bg-[#E0E0E0] hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-[#1E1E1E] dark:hover:text-neutral-100"
        >
          <IconReload size={14} stroke={2} />
          Retry
        </button>
      </div>
      <AuthModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
