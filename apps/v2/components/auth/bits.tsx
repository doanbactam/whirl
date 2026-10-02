"use client";

import {
  IconAlertCircleFilled,
  IconArrowRight,
  IconChevronLeft,
  IconLoader2,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { SquishButton } from "@/components/squish-button";
import { Button } from "@/components/ui/button";
import { pinRasterPath, SHED_BLUR } from "@/lib/motion";

/* Slide-and-blur swap for auth steps. Steps settle at the identity pose,
   so the raster pin keeps the landing frame from snapping a pixel. */
export const stepMotion = {
  initial: { opacity: 0, x: 8, filter: "blur(4px)" },
  animate: {
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transitionEnd: SHED_BLUR,
  },
  exit: { opacity: 0, x: -8, filter: "blur(4px)" },
  transition: { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] as const },
  transformTemplate: pinRasterPath,
};

/* Flattens one Clerk call's failure into a showable sentence. */
export function describeError(
  error: { longMessage?: string; message?: string } | null | undefined,
): string {
  return (
    error?.longMessage || error?.message || "Something went wrong. Try again."
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <IconLoader2 size={size} className="animate-spin" />;
}

export function StepTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-4 flex flex-col items-center gap-1 text-center">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-balance text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mt-1 mb-2 flex h-7 cursor-pointer items-center gap-0.5 self-start rounded-md pr-2 pl-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <IconChevronLeft size={14} />
      Back
    </button>
  );
}

/* Small inline text action: "Forgot password?", "Resend code", etc. */
export function SubtleAction({
  children,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground ${className}`}
    >
      {children}
    </button>
  );
}

export function SubmitButton({
  busy,
  held,
  children,
}: {
  /** This form's own work: spins the button and shuts it. */
  busy: boolean;
  /** Another route off the panel owns the wait — the Google handoff. Shut,
   *  but no second spinner: that button is already showing one. */
  held?: boolean;
  children: React.ReactNode;
}) {
  return (
    <SquishButton
      type="submit"
      disabled={busy || held}
      className="mt-1 h-10 w-full justify-center disabled:cursor-not-allowed disabled:opacity-70"
    >
      {busy ? (
        <Spinner />
      ) : (
        <>
          <span>{children}</span>
          <IconArrowRight size={15} />
        </>
      )}
    </SquishButton>
  );
}

export function GoogleButton({
  onClick,
  disabled,
  redirecting,
  signUp,
}: {
  onClick: () => void;
  disabled?: boolean;
  redirecting?: boolean;
  signUp?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      className="mb-3.5 h-10 w-full gap-2.5"
    >
      {redirecting ? (
        <>
          <Spinner />
          <span>Redirecting to Google…</span>
        </>
      ) : (
        <>
          <GoogleLogo />
          <span>{signUp ? "Sign up with Google" : "Continue with Google"}</span>
        </>
      )}
    </Button>
  );
}

function GoogleLogo() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.806.54-1.8368.8595-3.0477.8595-2.344 0-4.3282-1.5831-5.036-3.7104H.9573v2.3318C2.4382 15.9831 5.4818 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71c-.18-.54-.2823-1.1168-.2823-1.71s.1023-1.17.2823-1.71V4.9582H.9573C.3477 6.1732 0 7.5468 0 9s.3477 2.8268.9573 4.0418L3.964 10.71z"
      />
      <path
        fill="#EA4335"
        d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.656 3.5795 9 3.5795z"
      />
    </svg>
  );
}

export function Divider() {
  return (
    <div className="mb-3.5 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground">or</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -4, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ duration: 0.16 }}
          className="overflow-hidden"
        >
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-xs text-destructive ring-1 ring-destructive/20 dark:bg-destructive/15">
            <IconAlertCircleFilled size={13} className="mt-px shrink-0" />
            <span className="leading-snug">{message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SwitchHint({
  prompt,
  actionLabel,
  onClick,
}: {
  prompt: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <p className="mt-4 text-center text-xs text-muted-foreground">
      {prompt}{" "}
      <button
        type="button"
        onClick={onClick}
        className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline"
      >
        {actionLabel}
      </button>
    </p>
  );
}

/* Clerk mounts its smart CAPTCHA here when bot protection is on. */
export function CaptchaSlot() {
  return <div id="clerk-captcha" className="empty:hidden" />;
}
