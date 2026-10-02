import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  IconCheck,
  IconCircleCheckFilled,
  IconDownload,
  IconLink,
  IconX,
} from "@tabler/icons-react";

import {
  IntegrationLogo,
  VerifiedBadge,
} from "~/components/integrations/integration-logo";
import { ModalCard } from "~/components/modal-card";
import { MorphHeight } from "~/components/morph-height";
import { Spinner } from "~/components/spinner";
import type { StoreSkill } from "~/data/skillStore";
import { showToast } from "~/data/toasts";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

// The skill install journey is the integration modal's little sibling:
// details → success, no auth steps, no quota — a skill is just text.
type Step = "details" | "success";

const stepMotion = {
  initial: { opacity: 0, x: 16, filter: "blur(4px)" },
  animate: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: { opacity: 0, x: -16, filter: "blur(4px)" },
  transition: { duration: 0.22, ease: [0.22, 0.61, 0.36, 1] as const },
};

const PRIMARY_BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#0c82f2] px-4 text-[13px] font-medium text-white transition hover:bg-[#0a74d8] disabled:cursor-not-allowed disabled:opacity-50";
const GHOST_BUTTON =
  "inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] font-medium text-neutral-600 transition hover:bg-black/[0.05] dark:text-neutral-300 dark:hover:bg-white/[0.06]";

export function SkillInstallModal({
  skill,
  onClose,
  /** Called before any install work; return false to block (auth/plan gates). */
  onBeforeInstall,
  install,
}: {
  skill: StoreSkill | null;
  onClose: () => void;
  onBeforeInstall: () => boolean;
  install: (args: { id: string }) => Promise<{ installId: string }>;
}) {
  const capture = useCapture();
  const [step, setStep] = useState<Step>("details");
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const open = skill !== null;

  // Fresh slate whenever a different listing opens.
  useEffect(() => {
    if (!open) return;
    setStep("details");
    setBusy(false);
  }, [open, skill?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onInstallClick = async () => {
    if (!skill || busy) return;
    if (!onBeforeInstall()) return;
    setBusy(true);
    try {
      await install({ id: skill.id });
      capture(ANALYTICS_EVENTS.skillInstalled, { skill: skill.name });
      setStep("success");
    } catch (error) {
      showToast({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Couldn't install that. Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && skill && (
        <motion.div
          key="skill-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[6px] dark:bg-black/50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            key="skill-modal"
            initial={{ opacity: 0, y: 8, scale: 0.97, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 4, scale: 0.98, filter: "blur(4px)" }}
            transition={{
              opacity: { duration: 0.18 },
              filter: { duration: 0.2 },
              y: { type: "spring", stiffness: 360, damping: 30 },
              scale: { type: "spring", stiffness: 360, damping: 30 },
            }}
            role="dialog"
            aria-modal="true"
            aria-label={skill.name}
            className="w-full max-w-md"
          >
            <ModalCard>
            {/* The card morphs to each step's natural height — keyed by the
                listing so a reopen never paints a frame at the previous
                listing's size. */}
            <MorphHeight key={skill.id}>
              <AnimatePresence mode="popLayout" initial={false}>
                {step === "details" && (
                  <motion.div
                    key="details"
                    {...stepMotion}
                    className="flex w-full flex-col"
                  >
                    <DetailsStep
                      skill={skill}
                      busy={busy}
                      onClose={onClose}
                      onInstall={() => void onInstallClick()}
                    />
                  </motion.div>
                )}
                {step === "success" && (
                  <motion.div
                    key="success"
                    {...stepMotion}
                    className="flex w-full flex-col"
                  >
                    <SuccessStep skill={skill} onClose={onClose} />
                  </motion.div>
                )}
              </AnimatePresence>
            </MorphHeight>
            </ModalCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

const HEADER_BUTTON =
  "z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-neutral-500 backdrop-blur transition hover:bg-white hover:text-neutral-800 dark:bg-black/40 dark:text-neutral-300 dark:hover:bg-black/60 dark:hover:text-neutral-100";

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClose}
      className={`absolute right-3 top-3 ${HEADER_BUTTON}`}
    >
      <IconX size={15} stroke={2} />
    </button>
  );
}

/** Copies the listing's shareable URL (/integrations?s=<id>). */
function CopyLinkButton({ skill }: { skill: StoreSkill }) {
  const capture = useCapture();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Link copied" : "Copy link"}
      title="Copy link"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(
            `${window.location.origin}/integrations?s=${encodeURIComponent(skill.id)}`,
          );
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
          capture(ANALYTICS_EVENTS.skillLinkCopied, { skill: skill.name });
        } catch {
          showToast({ message: "Couldn't copy the link.", tone: "danger" });
        }
      }}
      className={`absolute right-12 top-3 ${HEADER_BUTTON}`}
    >
      {copied ? (
        <IconCheck size={15} stroke={2.25} className="text-emerald-500" />
      ) : (
        <IconLink size={15} stroke={2} />
      )}
    </button>
  );
}

function DetailsStep({
  skill,
  busy,
  onClose,
  onInstall,
}: {
  skill: StoreSkill;
  busy: boolean;
  onClose: () => void;
  onInstall: () => void;
}) {
  return (
    <>
      <div className="relative shrink-0">
        {skill.bannerUrl ? (
          <img
            src={skill.bannerUrl}
            alt=""
            aria-hidden
            className="h-28 w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="h-16 w-full bg-gradient-to-b from-black/[0.04] to-transparent dark:from-white/[0.05]" />
        )}
        <CopyLinkButton skill={skill} />
        <CloseButton onClose={onClose} />
        <div className="absolute -bottom-6 left-5">
          <IntegrationLogo
            name={skill.name}
            logoUrl={skill.logoUrl}
            iconSvg={skill.iconSvg}
            size={52}
            className="shadow-[0_4px_12px_rgba(0,0,0,0.12)]"
          />
        </div>
      </div>

      <div className="max-h-[48vh] overflow-y-auto px-5 pb-4 pt-9">
        <div className="flex items-center gap-1.5">
          <h2 className="truncate text-[16px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            {skill.name}
          </h2>
          {skill.verified && <VerifiedBadge size={16} />}
        </div>
        {skill.author && (
          <p className="mt-0.5 text-[12px] text-neutral-400 dark:text-neutral-500">
            by {skill.author}
          </p>
        )}
        {skill.description && (
          <p className="mt-2.5 text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300">
            {skill.description}
          </p>
        )}
        <p className="mt-3 text-[11.5px] text-neutral-400 dark:text-neutral-500">
          Skills are instructions Whirl picks up mid-chat, right when the task
          calls for them.
        </p>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-black/[0.06] bg-black/[0.02] px-4 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <button type="button" onClick={onClose} className={GHOST_BUTTON}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onInstall}
          disabled={busy || skill.installed}
          className={PRIMARY_BUTTON}
        >
          {busy ? (
            <Spinner size={14} className="text-white" />
          ) : (
            <IconDownload size={15} stroke={2} />
          )}
          {skill.installed ? "Installed" : "Install"}
        </button>
      </div>
    </>
  );
}

function SuccessStep({
  skill,
  onClose,
}: {
  skill: StoreSkill;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-6 pb-6 pt-10 text-center">
      <motion.span
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 22 }}
        className="text-emerald-500"
      >
        <IconCircleCheckFilled size={44} />
      </motion.span>
      <h2 className="mt-4 text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        {skill.name} is in!
      </h2>
      <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        Whirl will study up whenever a chat calls for it. Manage it anytime
        from the Installed tab.
      </p>
      <button
        type="button"
        onClick={onClose}
        className={`mt-5 ${PRIMARY_BUTTON}`}
      >
        Done
      </button>
    </div>
  );
}
