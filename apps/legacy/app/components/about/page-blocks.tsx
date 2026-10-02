import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

/**
 * The mini-site's editorial vocabulary: big titles, roomy ledes, pill CTAs.
 * Deliberately distinct from the app's UI components — the marketing pages
 * read like a publication, not a product shell.
 */

export function PageTitle({
  children,
  size = "lg",
  className = "",
}: {
  children: ReactNode;
  /** "lg" is the full editorial splash; "md" sits quieter above hero art. */
  size?: "md" | "lg";
  className?: string;
}) {
  const sizeClass =
    size === "lg"
      ? "text-[44px] sm:text-[60px]"
      : "text-[30px] sm:text-[38px]";
  return (
    <h1
      className={`${sizeClass} font-semibold leading-[1.02] tracking-tight text-neutral-900 dark:text-neutral-50 ${className}`}
    >
      {children}
    </h1>
  );
}

export function SectionTitle({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`text-[24px] font-semibold leading-[1.1] tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-[28px] ${className}`}
    >
      {children}
    </h2>
  );
}

/** Text beside a visual, alternating sides via `reverse` for page rhythm. */
export function SplitSection({
  title,
  body,
  visual,
  reverse = false,
  className = "",
}: {
  title: string;
  body: string;
  visual: ReactNode;
  reverse?: boolean;
  className?: string;
}) {
  return (
    <section
      className={`grid items-center gap-8 sm:grid-cols-2 sm:gap-12 ${className}`}
    >
      <div className={reverse ? "sm:order-2 sm:text-right" : ""}>
        <SectionTitle>{title}</SectionTitle>
        <p
          className={`mt-4 max-w-md text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400 ${reverse ? "sm:ml-auto" : ""}`}
        >
          {body}
        </p>
      </div>
      <div className={reverse ? "sm:order-1" : ""}>{visual}</div>
    </section>
  );
}

export function Lede({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`max-w-xl text-[16px] leading-relaxed text-neutral-600 dark:text-neutral-400 sm:text-[17px] ${className}`}
    >
      {children}
    </p>
  );
}

/** Pill-shaped CTA — filled for the primary action, ghosted for the rest. */
export function CtaLink({
  to,
  href,
  primary = false,
  cta,
  children,
}: {
  to?: string;
  href?: string;
  primary?: boolean;
  /** Analytics label for about_cta_clicked. */
  cta: string;
  children: ReactNode;
}) {
  const capture = useCapture();
  const className = `inline-flex h-10 w-fit items-center rounded-full px-5 text-[14px] font-medium transition-[background-color,scale] duration-200 ease-out active:scale-[0.96] ${
    primary
      ? "bg-[#0C82F2] text-white hover:bg-[#0b76dc]"
      : "border border-black/[0.1] text-neutral-700 hover:bg-black/[0.04] dark:border-white/[0.12] dark:text-neutral-200 dark:hover:bg-white/[0.06]"
  }`;
  const onClick = () => capture(ANALYTICS_EVENTS.aboutCtaClicked, { cta });

  if (to) {
    return (
      <Link to={to} onClick={onClick} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a
      href={href}
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noreferrer" : undefined}
      onClick={onClick}
      className={className}
    >
      {children}
    </a>
  );
}
