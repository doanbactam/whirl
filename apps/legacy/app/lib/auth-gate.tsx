import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useAuth } from "@clerk/tanstack-react-start";

import { AuthModal } from "~/components/auth-modal";

type AuthGateContextValue = {
  /** Whether the current visitor is signed in. */
  isSignedIn: boolean;
  /**
   * Prompt the visitor to sign in / sign up. Call this whenever a signed-out
   * visitor tries to do something that requires an account (e.g. inference).
   * Returns `true` if they're already signed in (caller may proceed), or
   * `false` if the modal was opened instead.
   */
  requireAuth: () => boolean;
};

const AuthGateContext = createContext<AuthGateContextValue | null>(null);

export function AuthGateProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [open, setOpen] = useState(false);

  const requireAuth = useCallback(() => {
    if (isSignedIn) return true;
    setOpen(true);
    return false;
  }, [isSignedIn]);

  // If the visitor signs in (here or in another tab), close the prompt.
  useEffect(() => {
    if (isSignedIn) setOpen(false);
  }, [isSignedIn]);

  return (
    <AuthGateContext.Provider
      value={{ isSignedIn: Boolean(isLoaded && isSignedIn), requireAuth }}
    >
      {children}
      <AuthModal open={open && !isSignedIn} onClose={() => setOpen(false)} />
    </AuthGateContext.Provider>
  );
}

export function useAuthGate() {
  const ctx = useContext(AuthGateContext);
  if (!ctx) {
    throw new Error("useAuthGate must be used within an AuthGateProvider");
  }
  return ctx;
}
