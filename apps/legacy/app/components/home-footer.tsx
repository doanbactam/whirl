import { useState } from "react";
import { IconBrandDiscord, IconCheck, IconCopy } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";

import { AnterraLogo } from "~/components/anterra-logo";
import { showToast } from "~/data/toasts";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

const LEGAL_LINKS = {
  privacy: "https://anterra.sh/legal/whirl/privacy",
  terms: "https://anterra.sh/legal/whirl/terms",
} as const;

const STATUS_URL = "https://status.whirl.chat";
const DISCORD_URL = "https://discord.gg/SrgwbaGHqE";

const CONTACT_EMAIL = "hello@whirl.chat";

const linkClass =
  "transition-colors hover:text-neutral-600 dark:hover:text-neutral-300";

function Dot() {
  return (
    <span aria-hidden className="text-neutral-300 dark:text-neutral-700">
      ·
    </span>
  );
}

/**
 * Small, quiet footer for the new-chat screen: the Anterra mark, legal links,
 * and a tap-to-copy contact email — all bunched together and centered.
 * Deliberately understated so it never competes with the composer above it.
 */
export function HomeFooter() {
  const capture = useCapture();
  const [copiedKey, setCopiedKey] = useState<"email" | null>(null);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopiedKey("email");
      setTimeout(() => setCopiedKey(null), 1500);
      capture(ANALYTICS_EVENTS.contactEmailCopied);
      showToast({ message: "email copied — say hi anytime ✨", tone: "success" });
    } catch {
      showToast({ message: `reach us at ${CONTACT_EMAIL}`, tone: "info" });
    }
  };

  const EmailGlyph = copiedKey === "email" ? IconCheck : IconCopy;

  return (
    <footer className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-center gap-2.5 px-2 py-3 text-[11px] text-neutral-400 dark:text-neutral-500">
      <AnterraLogo size={14} className="text-neutral-400 dark:text-neutral-500" />
      <Dot />
        <Link
          to="/about"
          onClick={() =>
            capture(ANALYTICS_EVENTS.footerLinkClicked, { link: "about" })
          }
          className={linkClass}
        >
          Learn More
        </Link>
        <Dot />
        <a
          href={LEGAL_LINKS.privacy}
          target="_blank"
          rel="noreferrer"
          onClick={() =>
            capture(ANALYTICS_EVENTS.legalLinkClicked, { which: "privacy" })
          }
          className={linkClass}
        >
          Privacy
        </a>
        <Dot />
        <a
          href={LEGAL_LINKS.terms}
          target="_blank"
          rel="noreferrer"
          onClick={() =>
            capture(ANALYTICS_EVENTS.legalLinkClicked, { which: "terms" })
          }
          className={linkClass}
        >
          Terms
        </a>
        <Dot />
        <a
          href={STATUS_URL}
          target="_blank"
          rel="noreferrer"
          onClick={() =>
            capture(ANALYTICS_EVENTS.footerLinkClicked, { link: "status" })
          }
          className={linkClass}
        >
          Status
        </a>
        <Dot />
        <button
          type="button"
          onClick={copyEmail}
          aria-label={copiedKey === "email" ? "Email copied" : `Copy ${CONTACT_EMAIL}`}
          className={`flex items-center gap-1 ${linkClass}`}
        >
          <EmailGlyph size={11} stroke={2} />
          {copiedKey === "email" ? "copied" : CONTACT_EMAIL}
        </button>
        <Dot />
        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Discord"
          title="Discord"
          onClick={() =>
            capture(ANALYTICS_EVENTS.footerLinkClicked, { link: "discord" })
          }
          className={`flex items-center ${linkClass}`}
        >
          <IconBrandDiscord size={13} stroke={2} />
        </a>
    </footer>
  );
}
