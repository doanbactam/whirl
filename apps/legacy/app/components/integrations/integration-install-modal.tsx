import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  IconArrowLeft,
  IconCheck,
  IconCircleCheckFilled,
  IconDownload,
  IconKeyFilled,
  IconLink,
  IconTool,
  IconX,
} from "@tabler/icons-react";

import { FadeInImage } from "~/components/fade-in-image";
import {
  IntegrationLogo,
  VerifiedBadge,
} from "~/components/integrations/integration-logo";
import { ModalCard } from "~/components/modal-card";
import { MorphHeight } from "~/components/morph-height";
import { Spinner } from "~/components/spinner";
import { openAuthPopup, openOAuthPopup } from "~/data/mcpServers";
import type { StoreIntegration } from "~/data/integrationStore";
import { showToast } from "~/data/toasts";
import { userErrorMessage } from "~/lib/errors";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

// The install journey, one modal, several steps:
//   details → (apiKey: fill fields) or (oauth: wait for the popup) → success.
// "none" integrations jump straight from details to success. The row that an
// install creates is a plain MCP server, so once we're past `install` the
// existing OAuth machinery does all the heavy lifting.
type Step = "details" | "apiKey" | "oauth" | "success";

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
const INPUT_CLASS =
  "h-9 w-full rounded-lg border border-black/[0.08] bg-transparent px-3 text-[13px] text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-[#178dfb] focus:ring-2 focus:ring-[#178dfb]/30 dark:border-white/[0.1] dark:text-neutral-100 dark:placeholder:text-neutral-500";

export function IntegrationInstallModal({
  integration,
  onClose,
  /** Called before any install work; return false to block (auth/plan gates). */
  onBeforeInstall,
  install,
  startOAuth,
  startComposioConnect,
}: {
  integration: StoreIntegration | null;
  onClose: () => void;
  onBeforeInstall: () => boolean;
  install: (args: {
    id: string;
    secrets?: { key: string; value: string }[];
  }) => Promise<{ serverId: string }>;
  startOAuth: (args: { id: string }) => Promise<{ authorizationUrl: string }>;
  startComposioConnect: (args: {
    id: string;
  }) => Promise<{ redirectUrl: string }>;
}) {
  const capture = useCapture();
  const [step, setStep] = useState<Step>("details");
  const [busy, setBusy] = useState(false);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [serverId, setServerId] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const open = integration !== null;

  // Fresh slate whenever a different listing opens.
  useEffect(() => {
    if (!open) return;
    setStep("details");
    setBusy(false);
    setSecrets({});
    setServerId(null);
    setOauthError(null);
  }, [open, integration?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // The OAuth callback page posts back through the popup's opener; while the
  // waiting step is up, that message is ours to handle.
  useEffect(() => {
    if (step !== "oauth") return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; ok?: boolean; error?: string }
        | undefined;
      if (data?.type !== "mcp-oauth") return;
      if (data.ok) {
        capture(ANALYTICS_EVENTS.integrationOAuthConnected, {
          integration: integration?.name,
        });
        setStep("success");
      } else {
        setOauthError(data.error || "Sign-in didn't finish. Try again.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [step, capture, integration?.name]);

  /** Create the install row (idempotent per listing thanks to the guard). */
  const createInstall = useCallback(
    async (withSecrets?: { key: string; value: string }[]) => {
      if (!integration) return null;
      if (serverId) return serverId;
      const result = await install({
        id: integration.id,
        secrets: withSecrets,
      });
      setServerId(result.serverId);
      capture(ANALYTICS_EVENTS.integrationInstalled, {
        integration: integration.name,
        auth_mode: integration.authMode,
      });
      return result.serverId;
    },
    [integration, serverId, install, capture],
  );

  const beginOAuth = useCallback(
    async (id: string) => {
      setOauthError(null);
      capture(ANALYTICS_EVENTS.integrationOAuthStarted, {
        integration: integration?.name,
      });
      // Composio-backed listings sign in through Composio's hosted link flow;
      // everything else runs MCP-spec OAuth. Same popup, same callback dialect.
      if (integration?.composioConnect) {
        await openAuthPopup(
          async () => (await startComposioConnect({ id })).redirectUrl,
        );
      } else {
        await openOAuthPopup(startOAuth, id);
      }
    },
    [capture, integration, startOAuth, startComposioConnect],
  );

  const onInstallClick = async () => {
    if (!integration || busy) return;
    if (!onBeforeInstall()) return;
    if (integration.authMode === "apiKey") {
      setStep("apiKey");
      return;
    }
    setBusy(true);
    try {
      // An install the user abandoned mid-sign-in resumes with its
      // existing row instead of installing again.
      const id = integration.installedServerId ?? (await createInstall());
      if (!id) return;
      if (integration.authMode === "oauth" || integration.composioConnect) {
        setServerId(id);
        setStep("oauth");
        // A failed launch surfaces on the waiting step, where retry lives.
        try {
          await beginOAuth(id);
        } catch (error) {
          setOauthError(
            userErrorMessage(error, "Couldn't start sign-in. Try again."),
          );
        }
      } else {
        setStep("success");
      }
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

  const onApiKeySubmit = async () => {
    if (!integration || busy) return;
    const filled = integration.authFields.map((f) => ({
      key: f.key,
      value: (secrets[f.key] ?? "").trim(),
    }));
    if (filled.some((f) => !f.value)) return;
    setBusy(true);
    try {
      await createInstall(filled);
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
      {open && integration && (
        <motion.div
          key="integration-backdrop"
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
            key="integration-modal"
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
            aria-label={integration.name}
            className="w-full max-w-md"
          >
            <ModalCard>
            {/* The card morphs to each step's natural height — keyed by the
                listing so a reopen never paints a frame at the previous
                listing's size. */}
            <MorphHeight key={integration.id}>
              <AnimatePresence mode="popLayout" initial={false}>
                {step === "details" && (
                  <motion.div
                    key="details"
                    {...stepMotion}
                    className="flex w-full flex-col"
                  >
                    <DetailsStep
                      integration={integration}
                      busy={busy}
                      onClose={onClose}
                      onInstall={() => void onInstallClick()}
                    />
                  </motion.div>
                )}
                {step === "apiKey" && (
                  <motion.div
                    key="apiKey"
                    {...stepMotion}
                    className="flex w-full flex-col"
                  >
                    <ApiKeyStep
                      integration={integration}
                      secrets={secrets}
                      busy={busy}
                      onChange={(key, value) =>
                        setSecrets((prev) => ({ ...prev, [key]: value }))
                      }
                      onBack={() => setStep("details")}
                      onSubmit={() => void onApiKeySubmit()}
                    />
                  </motion.div>
                )}
                {step === "oauth" && (
                  <motion.div
                    key="oauth"
                    {...stepMotion}
                    className="flex w-full flex-col"
                  >
                    <OAuthStep
                      integration={integration}
                      error={oauthError}
                      onRetry={() => {
                        if (serverId)
                          void beginOAuth(serverId).catch((err) => {
                            setOauthError(
                              userErrorMessage(
                                err,
                                "Couldn't start sign-in. Try again.",
                              ),
                            );
                          });
                      }}
                      onClose={onClose}
                    />
                  </motion.div>
                )}
                {step === "success" && (
                  <motion.div
                    key="success"
                    {...stepMotion}
                    className="flex w-full flex-col"
                  >
                    <SuccessStep
                      integration={integration}
                      onClose={onClose}
                    />
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

/** Copies the listing's shareable URL (/integrations?i=<id>). */
function CopyLinkButton({ integration }: { integration: StoreIntegration }) {
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
            `${window.location.origin}/integrations?i=${encodeURIComponent(integration.id)}`,
          );
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
          capture(ANALYTICS_EVENTS.integrationLinkCopied, {
            integration: integration.name,
          });
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
  integration,
  busy,
  onClose,
  onInstall,
}: {
  integration: StoreIntegration;
  busy: boolean;
  onClose: () => void;
  onInstall: () => void;
}) {
  const installed = integration.installedConnected;
  // An OAuth install that never finished signing in: offer to pick it back up.
  const pendingAuth = integration.installedServerId !== null && !installed;
  return (
    <>
      <div className="relative shrink-0">
        {integration.bannerUrl ? (
          <FadeInImage src={integration.bannerUrl} className="h-28 w-full" />
        ) : (
          <div className="h-16 w-full bg-gradient-to-b from-black/[0.04] to-transparent dark:from-white/[0.05]" />
        )}
        <CopyLinkButton integration={integration} />
        <CloseButton onClose={onClose} />
        <div className="absolute -bottom-6 left-5">
          <IntegrationLogo
            name={integration.name}
            logoUrl={integration.logoUrl}
            iconSvg={integration.iconSvg}
            size={52}
            className="shadow-[0_4px_12px_rgba(0,0,0,0.12)]"
          />
        </div>
      </div>

      <div className="max-h-[48vh] overflow-y-auto px-5 pb-4 pt-9">
        <div className="flex items-center gap-1.5">
          <h2 className="truncate text-[16px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            {integration.name}
          </h2>
          {integration.verified && <VerifiedBadge size={16} />}
        </div>
        {integration.author && (
          <p className="mt-0.5 text-[12px] text-neutral-400 dark:text-neutral-500">
            by {integration.author}
          </p>
        )}
        {integration.description && (
          <p className="mt-2.5 text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300">
            {integration.description}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {integration.tools.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] px-2.5 py-1 text-[11.5px] font-medium text-neutral-600 dark:bg-white/[0.06] dark:text-neutral-300">
              <IconTool size={12} stroke={2} />
              {integration.tools.length}{" "}
              {integration.tools.length === 1 ? "tool" : "tools"}
            </span>
          )}
          {(integration.authMode !== "none" ||
            integration.composioConnect) && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] px-2.5 py-1 text-[11.5px] font-medium text-neutral-600 dark:bg-white/[0.06] dark:text-neutral-300">
              <IconKeyFilled size={12} />
              {integration.authMode === "apiKey"
                ? "Needs an API key"
                : "Sign in to connect"}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-black/[0.06] bg-black/[0.02] px-4 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <button type="button" onClick={onClose} className={GHOST_BUTTON}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onInstall}
          disabled={busy || installed}
          className={PRIMARY_BUTTON}
        >
          {busy ? (
            <Spinner size={14} className="text-white" />
          ) : (
            <IconDownload size={15} stroke={2} />
          )}
          {installed
            ? "Installed"
            : pendingAuth
              ? "Finish connecting"
              : "Install"}
        </button>
      </div>
    </>
  );
}

function ApiKeyStep({
  integration,
  secrets,
  busy,
  onChange,
  onBack,
  onSubmit,
}: {
  integration: StoreIntegration;
  secrets: Record<string, string>;
  busy: boolean;
  onChange: (key: string, value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const incomplete = integration.authFields.some(
    (f) => !(secrets[f.key] ?? "").trim(),
  );
  return (
    <>
      <div className="max-h-[48vh] overflow-y-auto px-5 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <IntegrationLogo
            name={integration.name}
            logoUrl={integration.logoUrl}
            iconSvg={integration.iconSvg}
            size={36}
          />
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              Connect {integration.name}
            </h2>
            <p className="text-[12px] text-neutral-400 dark:text-neutral-500">
              One quick step and it's yours
            </p>
          </div>
        </div>

        {integration.authInstructions && (
          <p className="mt-3 whitespace-pre-wrap rounded-lg bg-black/[0.025] px-3 py-2.5 text-[12.5px] leading-relaxed text-neutral-600 dark:bg-white/[0.04] dark:text-neutral-300">
            {integration.authInstructions}
          </p>
        )}

        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {integration.authFields.map((field, i) => (
            <label key={field.key} className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-neutral-600 dark:text-neutral-300">
                {field.label}
              </span>
              <input
                type="password"
                autoComplete="off"
                autoFocus={i === 0}
                value={secrets[field.key] ?? ""}
                onChange={(e) => onChange(field.key, e.target.value)}
                placeholder="Paste it here"
                className={INPUT_CLASS}
              />
            </label>
          ))}
        </form>

        <p className="mt-3 text-[11.5px] text-neutral-400 dark:text-neutral-500">
          Stored encrypted, never shown to anyone — not even you, after this.
        </p>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-black/[0.06] bg-black/[0.02] px-4 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <button type="button" onClick={onBack} className={GHOST_BUTTON}>
          <IconArrowLeft size={14} stroke={2} className="mr-1" />
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || incomplete}
          className={PRIMARY_BUTTON}
        >
          {busy && <Spinner size={14} className="text-white" />}
          Connect
        </button>
      </div>
    </>
  );
}

function OAuthStep({
  integration,
  error,
  onRetry,
  onClose,
}: {
  integration: StoreIntegration;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="relative flex flex-col items-center px-6 pb-6 pt-10 text-center">
      <CloseButton onClose={onClose} />
      <IntegrationLogo
        name={integration.name}
        logoUrl={integration.logoUrl}
        iconSvg={integration.iconSvg}
        size={52}
      />
      {error ? (
        <>
          <h2 className="mt-4 text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            That didn't go through
          </h2>
          <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            {error}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className={`mt-5 ${PRIMARY_BUTTON}`}
          >
            Try signing in again
          </button>
        </>
      ) : (
        <>
          <div className="mt-5">
            <Spinner size={20} className="text-blue-500" />
          </div>
          <h2 className="mt-4 text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Waiting for you to sign in
          </h2>
          <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            Finish connecting {integration.name} in the popup window. We'll take
            it from there.
          </p>
        </>
      )}
    </div>
  );
}

function SuccessStep({
  integration,
  onClose,
}: {
  integration: StoreIntegration;
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
        {integration.name} is in!
      </h2>
      <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        Whirl can now use its tools in any chat. Manage it anytime from the
        Installed tab.
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
