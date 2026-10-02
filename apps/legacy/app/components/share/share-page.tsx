import { useState, type ReactNode } from "react";
import {
  IconArrowUpRight,
  IconCircleCheckFilled,
  IconLink,
  IconSparkles,
} from "@tabler/icons-react";

import { RainbowLoader } from "~/components/rainbow-loader";
import { WhirlLogo } from "~/components/whirl-logo";

/* The shared chrome for public artifact share pages (/visual/{shortId},
   /doc/{shortId}): the page shell, the Whirl top bar with a copy-link
   button, the "made with Whirl" promo footer, and the loading / not-found
   states. Each route brings its own artifact body. */

/** The neutral page background + centered column every share page sits in. */
export function SharePageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh w-full bg-[#f8f8fa] text-neutral-900 dark:bg-[#171718] dark:text-neutral-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1040px] flex-col px-4 py-5 sm:py-8">
        {children}
      </div>
    </div>
  );
}

/** The card every share page's artifact body sits in. */
export function ShareCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-black/[0.06] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_18px_40px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.02] dark:border-white/[0.06] dark:bg-[#1A1A19] dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_18px_40px_rgba(0,0,0,0.5)] dark:ring-white/[0.02]">
      {children}
    </div>
  );
}

export function ShareTopBar({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be blocked; ignore.
    }
  };

  const LinkGlyph = copied ? IconCircleCheckFilled : IconLink;

  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-black/[0.06] bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-white/[0.06] dark:bg-[#1A1A19]">
      <a
        href="/"
        className="flex shrink-0 items-center gap-2"
        aria-label="Whirl home"
      >
        <WhirlLogo size={24} />
        <span className="text-[15px] font-semibold tracking-tight">Whirl</span>
      </a>
      <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-500 dark:text-neutral-400">
        {title}
      </span>
      <button
        type="button"
        onClick={copyLink}
        title="Copy share link"
        aria-label="Copy share link"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
      >
        <LinkGlyph
          size={16}
          stroke={2}
          className={copied ? "text-emerald-500" : ""}
        />
      </button>
      <a
        href="/"
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[#0c82f2] pl-3 pr-2.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#0a74d8]"
      >
        Try Whirl free
        <IconArrowUpRight size={14} stroke={2.5} />
      </a>
    </div>
  );
}

export function SharePromo({ line }: { line: string }) {
  return (
    <div className="mt-6 flex flex-col items-center gap-4 py-4 text-center">
      <p className="max-w-md text-[13.5px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        Made with{" "}
        <span className="font-semibold text-neutral-700 dark:text-neutral-200">
          Whirl
        </span>
        . {line}
      </p>
      <a
        href="/"
        className="group flex h-10 items-center gap-2 rounded-xl bg-[#0c82f2] px-5 text-[13.5px] font-semibold text-white shadow-[0_2px_10px_rgba(12,130,242,0.35)] transition-colors hover:bg-[#0a74d8]"
      >
        <IconSparkles size={16} stroke={2} />
        Create your own with Whirl
        <IconArrowUpRight
          size={15}
          stroke={2.5}
          className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        />
      </a>
    </div>
  );
}

export function ShareLoadingState() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <RainbowLoader />
    </div>
  );
}

export function ShareNotFoundState({ headline }: { headline: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
      <WhirlLogo size={40} />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[17px] font-semibold text-neutral-900 dark:text-neutral-100">
          {headline}
        </h1>
        <p className="max-w-sm text-[13.5px] text-neutral-500 dark:text-neutral-400">
          The link may be wrong, or it was removed. But you can make your own in
          seconds.
        </p>
      </div>
      <a
        href="/"
        className="flex h-10 items-center gap-2 rounded-xl bg-[#0c82f2] px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#0a74d8]"
      >
        <IconSparkles size={16} stroke={2} />
        Try Whirl free
      </a>
    </div>
  );
}
