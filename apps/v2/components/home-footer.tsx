"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  IconBrandDiscord,
  IconBrandGithubFilled,
  IconCheck,
  IconCopy,
} from "@tabler/icons-react";

import { SITE_LINKS } from "@/lib/site";
import { showToast } from "@/lib/toasts";
import { AnterraLogo } from "./anterra-logo";

const linkClass =
  "transition-colors hover:text-neutral-600 dark:hover:text-neutral-300";

function Dot() {
  return (
    <span aria-hidden className="text-neutral-300 dark:text-neutral-700">
      ·
    </span>
  );
}

function ExternalLink({
  href,
  label,
  children,
}: {
  href: string;
  /** For icon-only links, which have no text of their own. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      className={`flex items-center ${linkClass}`}
    >
      {children}
    </a>
  );
}

function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      showToast("Email copied — say hi anytime ✨");
    } catch {
      showToast(`Reach us at ${email}`);
    }
  };

  const EmailGlyph = copied ? IconCheck : IconCopy;

  return (
    <button
      type="button"
      onClick={() => void copyEmail()}
      aria-label={copied ? "Email copied" : `Copy ${email}`}
      className={`flex items-center gap-1 ${linkClass}`}
    >
      <EmailGlyph size={11} stroke={2} />
      {copied ? "Copied" : email}
    </button>
  );
}

export function HomeFooter() {
  /* The optional links (lib/site.ts) drop out when a deployment sets them to
     null, and the dots only ever sit between what's left. */
  const items: ReactNode[] = [
    <AnterraLogo key="maker" size={14} />,
    <Link key="about" href="/about" className={linkClass}>
      Learn More
    </Link>,
    SITE_LINKS.privacy && (
      <ExternalLink key="privacy" href={SITE_LINKS.privacy}>
        Privacy
      </ExternalLink>
    ),
    SITE_LINKS.terms && (
      <ExternalLink key="terms" href={SITE_LINKS.terms}>
        Terms
      </ExternalLink>
    ),
    SITE_LINKS.status && (
      <ExternalLink key="status" href={SITE_LINKS.status}>
        Status
      </ExternalLink>
    ),
    SITE_LINKS.contactEmail && (
      <CopyEmailButton key="email" email={SITE_LINKS.contactEmail} />
    ),
    <span key="social" className="flex items-center gap-2">
      <ExternalLink href={SITE_LINKS.repo} label="Source code on GitHub">
        <IconBrandGithubFilled size={13} />
      </ExternalLink>
      {SITE_LINKS.discord && (
        <ExternalLink href={SITE_LINKS.discord} label="Discord">
          <IconBrandDiscord size={13} stroke={2} />
        </ExternalLink>
      )}
    </span>,
  ].filter(Boolean);

  return (
    <footer className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-center gap-2.5 px-2 py-3 text-[11px] text-neutral-400 dark:text-neutral-500">
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <Dot />}
          {item}
        </Fragment>
      ))}
    </footer>
  );
}
