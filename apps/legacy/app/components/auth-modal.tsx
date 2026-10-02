import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useSignIn, useSignUp } from "@clerk/tanstack-react-start/legacy";
import type { TablerIcon } from "@tabler/icons-react";
import {
  IconAlertCircle,
  IconChevronLeft,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconLock,
  IconMail,
  IconX,
} from "@tabler/icons-react";

import { DepthButton } from "~/components/depth-button";
import { Spinner } from "~/components/spinner";
import { Squircle } from "~/components/squircle";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

type Mode = "sign-in" | "sign-up";
type SignInStep =
  | "start"
  | "verify-2fa"
  | "forgot-email"
  | "forgot-reset";
type SignUpStep = "start" | "verify-email";

type ClerkErr = { errors?: Array<{ longMessage?: string; message?: string }> };

function describeError(err: unknown): string {
  const e = err as ClerkErr;
  const first = e?.errors?.[0];
  return (
    first?.longMessage ||
    first?.message ||
    (err instanceof Error ? err.message : "Something went wrong. Try again.")
  );
}

export function AuthModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && <AuthModalInner onClose={onClose} />}
    </AnimatePresence>,
    document.body,
  );
}

function AuthModalInner({ onClose }: { onClose?: () => void }) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const capture = useCapture();
  const switchTo = (next: Mode) => {
    capture(ANALYTICS_EVENTS.authModeSwitched, { to: next });
    setMode(next);
  };

  // Allow dismissing with Escape — visitors can keep browsing signed out.
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      key="auth-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
      className="fixed inset-0 z-[100050] flex items-center justify-center bg-black/30 px-4 py-10 backdrop-blur-[8px] dark:bg-black/60"
      onMouseDown={onClose ? (e) => {
        if (e.target === e.currentTarget) onClose();
      } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={mode === "sign-in" ? "Sign in to Whirl" : "Sign up for Whirl"}
    >
      <motion.div
        key="auth-modal"
        initial={{ opacity: 0, y: 12, scale: 0.96, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: 8, scale: 0.97, filter: "blur(6px)" }}
        transition={{
          opacity: { duration: 0.22 },
          filter: { duration: 0.24 },
          y: { type: "spring", stiffness: 320, damping: 30 },
          scale: { type: "spring", stiffness: 320, damping: 30 },
        }}
        className="w-full max-w-[400px]"
      >
        <Squircle
          radius={24}
          className="relative flex flex-col overflow-hidden rounded-[24px] border border-black/[0.06] bg-white shadow-[0_30px_80px_rgba(0,0,0,0.18),_0_4px_12px_rgba(0,0,0,0.08)] dark:border-white/[0.06] dark:bg-[#1A1A1A] dark:shadow-[0_30px_80px_rgba(0,0,0,0.7),_0_4px_12px_rgba(0,0,0,0.5)]"
        >
          <Header onClose={onClose} />
          <AnimatePresence mode="wait" initial={false}>
            {mode === "sign-in" ? (
              <SignInPanel key="sign-in" onSwitch={() => switchTo("sign-up")} />
            ) : (
              <SignUpPanel key="sign-up" onSwitch={() => switchTo("sign-in")} />
            )}
          </AnimatePresence>
        </Squircle>
      </motion.div>
    </motion.div>
  );
}

function Header({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 pb-2 pt-7">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-black/[0.05] hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-white/[0.06] dark:hover:text-neutral-300"
        >
          <IconX size={16} stroke={2} />
        </button>
      )}
      <div className="relative h-10 w-10">
        <img src="/whirl.svg" alt="Whirl" className="h-10 w-10 dark:invert" />
      </div>
    </div>
  );
}

const panelMotion = {
  initial: { opacity: 0, x: 8, filter: "blur(4px)" },
  animate: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: { opacity: 0, x: -8, filter: "blur(4px)" },
  transition: { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] as const },
};

function SignInPanel({ onSwitch }: { onSwitch: () => void }) {
  const { isLoaded, signIn, setActive } = useSignIn();
  const capture = useCapture();
  const [step, setStep] = useState<SignInStep>("start");

  // start
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // 2fa
  const [secondFactor, setSecondFactor] =
    useState<"phone_code" | "totp" | "backup_code">("totp");
  const [code2fa, setCode2fa] = useState("");

  // forgot
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [googleRedirecting, setGoogleRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goStart = () => {
    setError(null);
    setStep("start");
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await signIn.create({
        identifier: email,
        password,
      });

      if (result.status === "complete") {
        capture(ANALYTICS_EVENTS.authCompleted, {
          mode: "sign_in",
          method: "password",
        });
        await setActive({ session: result.createdSessionId });
        return;
      }

      if (result.status === "needs_second_factor") {
        const supported = result.supportedSecondFactors ?? [];
        const totp = supported.find(
          (f: { strategy: string }) => f.strategy === "totp",
        );
        const phone = supported.find(
          (f: { strategy: string }) => f.strategy === "phone_code",
        );
        if (totp) {
          setSecondFactor("totp");
        } else if (phone) {
          setSecondFactor("phone_code");
          await signIn.prepareSecondFactor({
            strategy: "phone_code",
            phoneNumberId: (phone as { phoneNumberId: string }).phoneNumberId,
          });
        } else {
          setSecondFactor("backup_code");
        }
        setStep("verify-2fa");
      } else {
        setError("Couldn't finish sign in. Please try again.");
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handle2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await signIn.attemptSecondFactor({
        strategy: secondFactor,
        code: code2fa,
      });
      if (result.status === "complete") {
        capture(ANALYTICS_EVENTS.authCompleted, {
          mode: "sign_in",
          method: "password",
          two_factor: true,
        });
        await setActive({ session: result.createdSessionId });
      } else {
        setError("Couldn't verify the code. Try again.");
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await signIn.create({
        strategy: "reset_password_email_code",
        identifier: email,
      });
      capture(ANALYTICS_EVENTS.passwordResetRequested);
      setStep("forgot-reset");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code: resetCode,
        password: newPassword,
      });
      if (result.status === "complete") {
        capture(ANALYTICS_EVENTS.passwordResetCompleted);
        capture(ANALYTICS_EVENTS.authCompleted, {
          mode: "sign_in",
          method: "password_reset",
        });
        await setActive({ session: result.createdSessionId });
      } else if (result.status === "needs_second_factor") {
        setSecondFactor("totp");
        setStep("verify-2fa");
      } else {
        setError("Couldn't reset password. Try again.");
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    if (!isLoaded || submitting) return;
    setError(null);
    setSubmitting(true);
    setGoogleRedirecting(true);
    capture(ANALYTICS_EVENTS.authStarted, {
      mode: "sign_in",
      method: "google",
    });
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/",
      });
    } catch (err) {
      setError(describeError(err));
      setSubmitting(false);
      setGoogleRedirecting(false);
    }
  };

  return (
    <motion.div {...panelMotion} className="px-6 pb-6 pt-2">
      {step === "start" && (
        <>
          <Title
            title="Welcome back"
            subtitle="Sign in to your Whirl account."
          />
          <GoogleButton onClick={handleGoogle} disabled={submitting} loading={googleRedirecting} />
          <Divider />
          <form onSubmit={handleSignIn} className="flex flex-col gap-2.5">
            <Field
              icon={IconMail}
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={setEmail}
              required
              autoFocus
            />
            <PasswordField
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={setPassword}
              required
            />
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("forgot-email");
              }}
              className="-mt-0.5 self-end text-[12px] text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              Forgot password?
            </button>
            <ErrorMessage message={error} />
            <ClerkCaptchaSlot />
            <SubmitButton submitting={submitting}>Continue</SubmitButton>
          </form>
          <SwitchHint
            prompt="Don't have an account?"
            actionLabel="Sign up"
            onClick={onSwitch}
          />
        </>
      )}

      {step === "verify-2fa" && (
        <>
          <BackButton onClick={goStart} />
          <Title
            title="Two-factor authentication"
            subtitle={
              secondFactor === "totp"
                ? "Enter the 6-digit code from your authenticator app."
                : secondFactor === "phone_code"
                  ? "Enter the code we just sent to your phone."
                  : "Enter one of your backup codes."
            }
          />
          <form onSubmit={handle2fa} className="flex flex-col gap-2.5">
            <CodeField
              value={code2fa}
              onChange={setCode2fa}
              placeholder={
                secondFactor === "backup_code" ? "Backup code" : "123456"
              }
              autoComplete="one-time-code"
              autoFocus
              required
            />
            {secondFactor !== "backup_code" && (
              <button
                type="button"
                onClick={() => {
                  setSecondFactor("backup_code");
                  setCode2fa("");
                }}
                className="-mt-0.5 self-start text-[12px] text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                Use a backup code instead
              </button>
            )}
            <ErrorMessage message={error} />
            <SubmitButton submitting={submitting}>Verify</SubmitButton>
          </form>
        </>
      )}

      {step === "forgot-email" && (
        <>
          <BackButton onClick={goStart} />
          <Title
            title="Reset your password"
            subtitle="Enter the email tied to your account and we'll send a code."
          />
          <form onSubmit={handleForgotEmail} className="flex flex-col gap-2.5">
            <Field
              icon={IconMail}
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={setEmail}
              required
              autoFocus
            />
            <ErrorMessage message={error} />
            <SubmitButton submitting={submitting}>Send code</SubmitButton>
          </form>
        </>
      )}

      {step === "forgot-reset" && (
        <>
          <BackButton onClick={() => setStep("forgot-email")} />
          <Title
            title="Set a new password"
            subtitle={`Enter the code we sent to ${email} and pick a new password.`}
          />
          <form onSubmit={handleForgotReset} className="flex flex-col gap-2.5">
            <CodeField
              value={resetCode}
              onChange={setResetCode}
              placeholder="123456"
              autoComplete="one-time-code"
              autoFocus
              required
            />
            <PasswordField
              autoComplete="new-password"
              placeholder="New password"
              value={newPassword}
              onChange={setNewPassword}
              required
            />
            <ErrorMessage message={error} />
            <SubmitButton submitting={submitting}>Reset password</SubmitButton>
          </form>
        </>
      )}
    </motion.div>
  );
}

function SignUpPanel({ onSwitch }: { onSwitch: () => void }) {
  const { isLoaded, signUp, setActive } = useSignUp();
  const capture = useCapture();
  const [step, setStep] = useState<SignUpStep>("start");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [googleRedirecting, setGoogleRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || submitting) return;
    setError(null);
    setSubmitting(true);
    capture(ANALYTICS_EVENTS.authStarted, {
      mode: "sign_up",
      method: "password",
    });
    try {
      await signUp.create({
        emailAddress: email,
        password,
      });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setStep("verify-email");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === "complete") {
        capture(ANALYTICS_EVENTS.emailVerificationCompleted);
        capture(ANALYTICS_EVENTS.authCompleted, {
          mode: "sign_up",
          method: "password",
        });
        await setActive({ session: result.createdSessionId });
      } else {
        setError("Couldn't verify your email. Try again.");
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!isLoaded || submitting) return;
    setError(null);
    try {
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
    } catch (err) {
      setError(describeError(err));
    }
  };

  const handleGoogle = async () => {
    if (!isLoaded || submitting) return;
    setError(null);
    setSubmitting(true);
    setGoogleRedirecting(true);
    capture(ANALYTICS_EVENTS.authStarted, {
      mode: "sign_up",
      method: "google",
    });
    try {
      await signUp.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/",
      });
    } catch (err) {
      setError(describeError(err));
      setSubmitting(false);
      setGoogleRedirecting(false);
    }
  };

  return (
    <motion.div {...panelMotion} className="px-6 pb-6 pt-2">
      {step === "start" && (
        <>
          <Title
            title="Create your account"
            subtitle="Spin up a Whirl account in seconds."
          />
          <GoogleButton onClick={handleGoogle} disabled={submitting} loading={googleRedirecting} signUp />
          <Divider />
          <form onSubmit={handleSignUp} className="flex flex-col gap-2.5">
            <Field
              icon={IconMail}
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={setEmail}
              required
              autoFocus
            />
            <PasswordField
              autoComplete="new-password"
              placeholder="Password"
              value={password}
              onChange={setPassword}
              required
            />
            <ErrorMessage message={error} />
            <ClerkCaptchaSlot />
            <SubmitButton submitting={submitting}>Create account</SubmitButton>
          </form>
          <SwitchHint
            prompt="Already have an account?"
            actionLabel="Sign in"
            onClick={onSwitch}
          />
        </>
      )}

      {step === "verify-email" && (
        <>
          <BackButton
            onClick={() => {
              setError(null);
              setStep("start");
            }}
          />
          <Title
            title="Verify your email"
            subtitle={`Enter the 6-digit code we sent to ${email}.`}
          />
          <form onSubmit={handleVerify} className="flex flex-col gap-2.5">
            <CodeField
              value={code}
              onChange={setCode}
              placeholder="123456"
              autoComplete="one-time-code"
              autoFocus
              required
            />
            <button
              type="button"
              onClick={handleResend}
              className="-mt-0.5 self-start text-[12px] text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              Resend code
            </button>
            <ErrorMessage message={error} />
            <SubmitButton submitting={submitting}>Verify email</SubmitButton>
          </form>
        </>
      )}
    </motion.div>
  );
}

function Title({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4 flex flex-col items-center gap-1 text-center">
      <h2 className="text-[20px] font-medium tracking-tight text-neutral-900 dark:text-neutral-50">
        {title}
      </h2>
      <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
        {subtitle}
      </p>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mt-1 mb-2 flex h-7 items-center gap-1 self-start rounded-md px-1.5 text-[12px] text-neutral-500 hover:bg-black/[0.05] hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-neutral-100"
    >
      <IconChevronLeft size={14} stroke={2} />
      Back
    </button>
  );
}

function Field({
  icon,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
  autoFocus,
}: {
  icon: TablerIcon;
  type: "email" | "text" | "password";
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const Glyph = icon;
  return (
    <div className="group relative flex h-11 items-center rounded-xl border border-black/[0.08] bg-white shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] transition-shadow focus-within:border-[#178dfb]/60 focus-within:shadow-[0_0_0_3px_rgba(23,141,251,0.15)] dark:border-white/[0.08] dark:bg-[#222] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] dark:focus-within:border-[#178dfb]/60 dark:focus-within:shadow-[0_0_0_3px_rgba(23,141,251,0.2)]">
      <span className="flex h-full w-10 shrink-0 items-center justify-center text-neutral-400 dark:text-neutral-500">
        <Glyph size={15} stroke={2} />
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        autoFocus={autoFocus}
        className="h-full flex-1 bg-transparent pr-3.5 text-[13.5px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
      />
    </div>
  );
}

function PasswordField(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete?: string;
  required?: boolean;
}) {
  const [show, setShow] = useState(false);
  const Glyph = show ? IconEyeOff : IconEye;
  return (
    <div className="group relative flex h-11 items-center rounded-xl border border-black/[0.08] bg-white shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] transition-shadow focus-within:border-[#178dfb]/60 focus-within:shadow-[0_0_0_3px_rgba(23,141,251,0.15)] dark:border-white/[0.08] dark:bg-[#222] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] dark:focus-within:border-[#178dfb]/60 dark:focus-within:shadow-[0_0_0_3px_rgba(23,141,251,0.2)]">
      <span className="flex h-full w-10 shrink-0 items-center justify-center text-neutral-400 dark:text-neutral-500">
        <IconLock size={15} stroke={2} />
      </span>
      <input
        type={show ? "text" : "password"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        required={props.required}
        className="h-full flex-1 bg-transparent pr-1 text-[13.5px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"}
        className="mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-black/[0.05] hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-white/[0.06] dark:hover:text-neutral-300"
      >
        <Glyph size={14} stroke={2} />
      </button>
    </div>
  );
}

function CodeField({
  value,
  onChange,
  placeholder,
  autoComplete,
  autoFocus,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete?: string;
  autoFocus?: boolean;
  required?: boolean;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      required={required}
      className="h-12 w-full rounded-xl border border-black/[0.08] bg-white text-center text-[18px] font-medium tracking-[0.4em] text-neutral-900 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] placeholder:font-normal placeholder:tracking-[0.2em] placeholder:text-neutral-300 focus:border-[#178dfb]/60 focus:shadow-[0_0_0_3px_rgba(23,141,251,0.15)] focus:outline-none dark:border-white/[0.08] dark:bg-[#222] dark:text-neutral-100 dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] dark:placeholder:text-neutral-600 dark:focus:border-[#178dfb]/60 dark:focus:shadow-[0_0_0_3px_rgba(23,141,251,0.2)]"
    />
  );
}

function SubmitButton({
  submitting,
  children,
}: {
  submitting: boolean;
  children: React.ReactNode;
}) {
  return (
    <DepthButton
      variant="blue"
      type="submit"
      disabled={submitting}
      className="mt-1.5 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-medium tracking-tight text-white disabled:cursor-not-allowed disabled:opacity-70"
    >
      {submitting ? (
        <Spinner size={16} className="text-white" />
      ) : (
        <>
          <span>{children}</span>
          <IconChevronRight size={14} stroke={2.5} />
        </>
      )}
    </DepthButton>
  );
}

function GoogleButton({
  onClick,
  disabled,
  loading,
  signUp,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  signUp?: boolean;
}) {
  return (
    <DepthButton
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mb-3.5 flex h-11 w-full items-center justify-center gap-2.5 rounded-xl text-[13.5px] font-medium text-neutral-800 disabled:cursor-not-allowed disabled:opacity-70 dark:text-neutral-100"
    >
      {loading ? (
        <>
          <Spinner size={16} className="text-blue-500" />
          <span>Redirecting to Google…</span>
        </>
      ) : (
        <>
          <GoogleLogo />
          <span>{signUp ? "Sign up with Google" : "Continue with Google"}</span>
        </>
      )}
    </DepthButton>
  );
}

function GoogleLogo() {
  return (
    <svg
      width="16"
      height="16"
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

function Divider() {
  return (
    <div className="mb-3.5 flex items-center gap-3">
      <span className="h-px flex-1 bg-black/[0.07] dark:bg-white/[0.08]" />
      <span className="text-[11px] uppercase tracking-[0.18em] text-neutral-400 dark:text-neutral-500">
        or
      </span>
      <span className="h-px flex-1 bg-black/[0.07] dark:bg-white/[0.08]" />
    </div>
  );
}

function ErrorMessage({ message }: { message: string | null }) {
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
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-2.5 py-2 text-[12px] text-red-700 dark:border-red-400/25 dark:bg-red-400/[0.08] dark:text-red-300">
            <IconAlertCircle
              size={13}
              stroke={2}
              className="mt-px shrink-0"
            />
            <span className="leading-snug">{message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SwitchHint({
  prompt,
  actionLabel,
  onClick,
}: {
  prompt: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <p className="mt-4 text-center text-[12.5px] text-neutral-500 dark:text-neutral-400">
      {prompt}{" "}
      <button
        type="button"
        onClick={onClick}
        className="font-medium text-neutral-900 underline-offset-2 hover:underline dark:text-neutral-100"
      >
        {actionLabel}
      </button>
    </p>
  );
}

function ClerkCaptchaSlot() {
  return <div id="clerk-captcha" className="empty:hidden" />;
}
