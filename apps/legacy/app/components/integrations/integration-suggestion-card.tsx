import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  IconBuildingStore,
  IconCircleCheckFilled,
  IconDownload,
} from "@tabler/icons-react";

import { ARTIFACT_SURFACE } from "~/components/artifact-card-shell";
import { IntegrationInstallModal } from "~/components/integrations/integration-install-modal";
import {
  IntegrationLogo,
  VerifiedBadge,
} from "~/components/integrations/integration-logo";
import { useIntegrationInstallGate } from "~/components/integrations/use-install-gate";
import {
  useIntegrationInstallActions,
  useSuggestedIntegrations,
  type StoreIntegration,
} from "~/data/integrationStore";
import type { Phase } from "~/data/messages";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

type SuggestionPhase = Extract<Phase, { kind: "integrationSuggestion" }>;

/**
 * Whirl found something in the integration store mid-reply: an inline card of
 * install buttons, rendered exactly where the suggestion happened. The phase
 * only carries listing ids + name snapshots; everything else (branding, auth
 * recipe, install state) hydrates live from the store — so installing one
 * flips its row to "Installed" reactively, even from another tab. Rows whose
 * listing has since been unlisted quietly drop out; if none survive, the card
 * renders nothing at all.
 */
export function IntegrationSuggestionCard({
  phase,
  animate,
}: {
  phase: SuggestionPhase;
  /** Whether this mount should play its entrance (false on cached threads). */
  animate: boolean;
}) {
  const capture = useCapture();
  const items = phase.items ?? [];
  const hydrated = useSuggestedIntegrations(
    items.map((item) => item.integrationId),
  );
  const { install, startOAuth, startComposioConnect } =
    useIntegrationInstallActions();
  const beforeInstall = useIntegrationInstallGate();
  const [openId, setOpenId] = useState<string | null>(null);

  // One "shown" event per card mount — not per reactive re-render.
  const capturedShown = useRef(false);
  useEffect(() => {
    if (capturedShown.current || items.length === 0) return;
    capturedShown.current = true;
    capture(ANALYTICS_EVENTS.integrationSuggestionShown, {
      count: items.length,
      integrations: items.map((item) => item.name),
      query: phase.query,
    });
  }, [capture, items, phase.query]);

  if (items.length === 0) return null;
  // Hydration landed and every suggested listing has since been unlisted —
  // nothing left to offer, so take up no space.
  if (hydrated !== undefined && hydrated.length === 0) return null;

  const open = openId
    ? (hydrated?.find((entry) => entry.id === openId) ?? null)
    : null;

  const onEntryClick = (entry: StoreIntegration, via: "row" | "install") => {
    capture(ANALYTICS_EVENTS.integrationSuggestionClicked, {
      integration: entry.name,
      installed: entry.installedConnected,
      via,
    });
    setOpenId(entry.id);
  };

  return (
    <>
      <motion.div
        initial={animate ? { opacity: 0, y: 6, filter: "blur(4px)" } : false}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{
          opacity: 0,
          y: -4,
          filter: "blur(4px)",
          transition: { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] },
        }}
        transition={{
          opacity: { duration: 0.24, ease: [0.22, 0.61, 0.36, 1] },
          filter: { duration: 0.26, ease: [0.22, 0.61, 0.36, 1] },
          default: { type: "spring", stiffness: 420, damping: 30 },
        }}
        className={`mt-1 w-[400px] max-w-full overflow-hidden ${ARTIFACT_SURFACE}`}
      >
        <div className="flex items-center gap-1.5 px-4 pt-3 pb-2 text-neutral-400 dark:text-neutral-500">
          <IconBuildingStore size={13} stroke={2} className="shrink-0" />
          <span className="text-[11.5px] leading-4 font-medium">
            From the integration store
          </span>
        </div>
        <div className="flex flex-col divide-y divide-black/[0.04] border-t border-black/[0.05] dark:divide-white/[0.04] dark:border-white/[0.06]">
          {(hydrated ?? skeletonEntries(items)).map((entry) => (
            <SuggestionRow
              key={entry.id}
              entry={entry}
              // Rows stay quiet until the store data lands — we don't know
              // an entry's auth recipe (or install state) from the snapshot.
              ready={hydrated !== undefined}
              onOpen={(via) => onEntryClick(entry, via)}
            />
          ))}
        </div>
      </motion.div>
      <IntegrationInstallModal
        integration={open}
        onClose={() => setOpenId(null)}
        onBeforeInstall={beforeInstall}
        install={install}
        startOAuth={startOAuth}
        startComposioConnect={startComposioConnect}
      />
    </>
  );
}

/** Placeholder rows from the phase's name snapshots while the store loads —
 * same layout as the hydrated card, so details fill in without a reflow. */
function skeletonEntries(
  items: { integrationId: string; name: string }[],
): StoreIntegration[] {
  return items.map((item) => ({
    id: item.integrationId,
    name: item.name,
    verified: false,
    logoUrl: null,
    bannerUrl: null,
    authMode: "none",
    authFields: [],
    tools: [],
    installedServerId: null,
    installedConnected: false,
    composioConnect: false,
  }));
}

function SuggestionRow({
  entry,
  ready,
  onOpen,
}: {
  entry: StoreIntegration;
  ready: boolean;
  onOpen: (via: "row" | "install") => void;
}) {
  const installed = entry.installedConnected;
  // An install left mid-sign-in (OAuth or Composio connect): the modal
  // resumes it rather than installing twice.
  const pendingAuth = entry.installedServerId !== null && !installed;

  return (
    <div className="group/row relative flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.03]">
      {/* The whole row opens the details modal (the description clamps at two
          lines, so the full pitch lives there). An overlay button keeps the
          HTML valid — the install pill is a sibling, not a nested button. */}
      <button
        type="button"
        aria-label={`About ${entry.name}`}
        disabled={!ready}
        onClick={() => onOpen("row")}
        className="absolute inset-0 disabled:cursor-default"
      />
      <span className="pointer-events-none relative shrink-0">
        <IntegrationLogo
          name={entry.name}
          logoUrl={entry.logoUrl}
          iconSvg={entry.iconSvg}
          size={40}
        />
      </span>
      <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[14px] leading-5 font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            {entry.name}
          </span>
          {entry.verified && <VerifiedBadge size={14} />}
        </span>
        {entry.description && (
          <span className="mt-0.5 line-clamp-2 text-[12px] leading-[1.4] text-neutral-500 dark:text-neutral-400">
            {entry.description}
          </span>
        )}
      </div>
      {installed ? (
        <span className="relative inline-flex shrink-0 items-center gap-1 pr-0.5 text-[12.5px] font-medium text-emerald-600 dark:text-emerald-400">
          <IconCircleCheckFilled size={15} />
          Installed
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onOpen("install")}
          disabled={!ready}
          className="relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-[#0c82f2] pr-3.5 pl-3 text-[12px] font-medium text-white shadow-[0_1px_2px_rgba(12,130,242,0.25)] transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
        >
          <IconDownload size={13} stroke={2.25} />
          {pendingAuth ? "Finish connecting" : "Install"}
        </button>
      )}
    </div>
  );
}
