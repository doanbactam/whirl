import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconCheck, IconChevronRight } from "@tabler/icons-react";

type Theme = "light" | "dark";

function readInitialTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem("theme", theme);
  } catch {}
}

type Status = "idle" | "submitting" | "success" | "error";

export function App() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [email, setEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "d" && e.key !== "D") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setTheme((prev) => (prev === "dark" ? "light" : "dark"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isLoading = status === "submitting";
  const isSuccess = status === "success";
  const canSubmit = email.trim().length > 0 && !isLoading;

  const submit = async () => {
    if (!canSubmit) return;
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setStatus("error");
      setErrorMessage("Please enter a valid email.");
      return;
    }
    setErrorMessage(null);
    setStatus("submitting");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: value,
          companyWebsite: honeypotRef.current?.value ?? "",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus("error");
        setErrorMessage(body.error ?? "Something went wrong. Try again.");
        return;
      }
      setSubmittedEmail(value);
      setStatus("success");
      setEmail("");
    } catch {
      setStatus("error");
      setErrorMessage("Network error. Check your connection and try again.");
    }
  };

  return (
    <div className="relative flex h-dvh w-full items-center justify-center overflow-hidden bg-[#F3F3F3] dark:bg-[#141414]">
      <BackgroundLogo />

      <main className="relative z-10 flex w-full max-w-md flex-col items-center px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.6, rotate: -14 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 360, damping: 20, mass: 0.9 }}
          className="relative h-16 w-16"
        >
          <img
            src="/whirl.svg"
            alt="Whirl"
            className={`h-16 w-16 transition-opacity duration-300 dark:invert ${isLoading ? "opacity-0" : "opacity-100"}`}
          />
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-0 animate-rainbow bg-[linear-gradient(90deg,#ff2e93,#ff7a00,#ffd400,#00d36e,#00b7ff,#7a5cff,#ff2e93)] bg-[length:200%_100%] transition-opacity duration-500 ${isLoading ? "opacity-100" : "opacity-0"}`}
            style={{
              WebkitMaskImage: "url(/whirl.svg)",
              maskImage: "url(/whirl.svg)",
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskSize: "contain",
              maskSize: "contain",
              WebkitMaskPosition: "center",
              maskPosition: "center",
            }}
          />
        </motion.div>

        <div className="mt-6 flex w-full flex-col items-center">
          <AnimatePresence mode="wait" initial={false}>
            {isSuccess ? (
              <SuccessPanel key="success" email={submittedEmail} />
            ) : (
              <FormPanel
                key="form"
                email={email}
                setEmail={(v) => {
                  setEmail(v);
                  if (status === "error") setStatus("idle");
                }}
                onSubmit={submit}
                isLoading={isLoading}
                canSubmit={canSubmit}
                errorMessage={status === "error" ? errorMessage : null}
                inputRef={inputRef}
                honeypotRef={honeypotRef}
              />
            )}
          </AnimatePresence>
        </div>
      </main>

      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.7 }}
        className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2 text-[12px] text-neutral-500 dark:text-neutral-500"
      >
        by{" "}
        <a
          href="https://median.sh"
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-neutral-700 underline-offset-4 transition-colors hover:text-neutral-900 hover:underline dark:text-neutral-300 dark:hover:text-neutral-50"
        >
          median
        </a>
      </motion.footer>
    </div>
  );
}

function FormPanel({
  email,
  setEmail,
  onSubmit,
  isLoading,
  canSubmit,
  errorMessage,
  inputRef,
  honeypotRef,
}: {
  email: string;
  setEmail: (v: string) => void;
  onSubmit: () => void | Promise<void>;
  isLoading: boolean;
  canSubmit: boolean;
  errorMessage: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  honeypotRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
      transition={{ duration: 0.35, ease: [0.22, 0.61, 0.36, 1] }}
      className="flex w-full flex-col items-center"
    >
      <motion.h1
        initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{
          opacity: { duration: 0.5, ease: [0.22, 0.61, 0.36, 1] },
          filter: { duration: 0.5, ease: [0.22, 0.61, 0.36, 1] },
          y: { type: "spring", stiffness: 320, damping: 28 },
        }}
        className="text-[44px] font-semibold leading-none tracking-tight text-neutral-900 dark:text-neutral-50"
      >
        Whirl
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1], delay: 0.12 }}
        className="mt-3 text-center text-[15px] leading-snug text-neutral-600 dark:text-neutral-400"
      >
        The first AI Chat app that actually cares about{" "}
        <span className="rainbow-text font-semibold">you</span>
      </motion.p>

      <motion.form
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1], delay: 0.22 }}
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
        className="mt-7 w-full"
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: "-9999px",
            width: "1px",
            height: "1px",
            overflow: "hidden",
          }}
        >
          <label htmlFor="company-website">Company website</label>
          <input
            ref={honeypotRef}
            id="company-website"
            name="company_website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </div>
        <label
          htmlFor="waitlist-email"
          className="flex w-full cursor-text items-center rounded-full border border-black/[0.06] bg-white/55 p-1.5 shadow-[0_4px_14px_rgba(0,0,0,0.06),_0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.06] dark:bg-[#1E1E1E]/55 dark:shadow-[0_4px_16px_rgba(0,0,0,0.4),_0_1px_2px_rgba(0,0,0,0.25)]"
        >
          <input
            ref={inputRef}
            id="waitlist-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            placeholder="Your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            className="block min-w-0 flex-1 bg-transparent px-4 text-[15px] leading-6 text-neutral-900 placeholder:text-neutral-400 focus:outline-none disabled:opacity-60 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
          <motion.button
            type="submit"
            aria-label={isLoading ? "Joining" : "Join waitlist"}
            disabled={!canSubmit}
            whileTap={canSubmit ? { scale: 0.9 } : undefined}
            className={`depth-neutral relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${
              canSubmit || isLoading
                ? "text-white"
                : "text-neutral-400 dark:text-neutral-500"
            }`}
          >
            <motion.span
              aria-hidden
              initial={false}
              animate={{ opacity: canSubmit || isLoading ? 1 : 0 }}
              transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
              style={{
                backgroundImage:
                  "linear-gradient(180deg, #3a9efc 0%, #178dfb 50%, #0c82f2 100%)",
              }}
              className="pointer-events-none absolute inset-0 rounded-full"
            />
            <span className="relative flex">
              <AnimatePresence mode="wait" initial={false}>
                {isLoading ? (
                  <motion.span
                    key="loading"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 22 }}
                    className="block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  />
                ) : (
                  <motion.span
                    key="arrow"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 22 }}
                    className="flex"
                  >
                    <IconChevronRight size={16} stroke={2.5} />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </motion.button>
        </label>

        <div className="mt-3 h-5 text-center text-[12.5px]">
          <AnimatePresence mode="wait" initial={false}>
            {errorMessage ? (
              <motion.span
                key="error"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
                className="text-red-600 dark:text-red-400"
              >
                {errorMessage}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
      </motion.form>
    </motion.div>
  );
}

function SuccessPanel({ email }: { email: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
      className="flex w-full flex-col items-center"
    >
      <motion.div
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 22, delay: 0.05 }}
        className="depth-blue flex h-12 w-12 items-center justify-center rounded-full text-white"
      >
        <IconCheck size={22} stroke={2.6} />
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{
          opacity: { duration: 0.45, ease: [0.22, 0.61, 0.36, 1], delay: 0.15 },
          filter: { duration: 0.45, ease: [0.22, 0.61, 0.36, 1], delay: 0.15 },
          y: { type: "spring", stiffness: 320, damping: 28, delay: 0.15 },
        }}
        className="mt-5 text-[28px] font-semibold leading-tight tracking-tight text-neutral-900 dark:text-neutral-50"
      >
        You're on the list
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1], delay: 0.26 }}
        className="mt-2 text-center text-[14px] leading-snug text-neutral-600 dark:text-neutral-400"
      >
        We'll reach out to{" "}
        <span className="font-medium text-neutral-800 dark:text-neutral-200">
          {email}
        </span>{" "}
        as soon as Whirl is ready.
      </motion.p>
    </motion.div>
  );
}

function BackgroundLogo() {
  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 0, scale: 0.96, rotate: -6 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={{ duration: 1.1, ease: [0.22, 0.61, 0.36, 1] }}
      className="pointer-events-none absolute -right-[28vmin] -bottom-[32vmin] z-0 h-[140vmin] w-[140vmin] select-none bg-[#E4E4E4] dark:bg-[#1C1C1C]"
      style={{
        WebkitMaskImage: "url(/whirl.svg)",
        maskImage: "url(/whirl.svg)",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}
