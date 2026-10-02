import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { IconSparkles, IconX } from "@tabler/icons-react";
import { DepthButton } from "./depth-button";
import { Squircle } from "~/components/squircle";
import { useLocalCurrency } from "~/lib/local-currency";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";
import { useOpenExtraUsage } from "~/lib/use-open-extra-usage";

export type GateFeature =
  | "usage"
  | "messages"
  | "can_search"
  | "auto"
  | "basic"
  | "pro"
  | "max"
  | "reasoning"
  | "files"
  | "memory"
  | "mcp"
  | "skills"
  | "compact"
  | "image"
  // Not a server gate sentinel — opened directly from the server-overload
  // notice to pitch paid plans' priority access. parseGateSentinel never
  // returns it.
  | "priority";

type PlanId = "mini" | "turbo" | "mega";

type RecommendedPlan = {
  id: PlanId;
  name: string;
  priceUsd: number;
  blurb: string;
};

const MINI: RecommendedPlan = {
  id: "mini",
  name: "Mini",
  priceUsd: 5,
  blurb: "A solid weekly budget for everyday use.",
};
const TURBO: RecommendedPlan = {
  id: "turbo",
  name: "Turbo",
  priceUsd: 12,
  blurb: "~2.5× Mini's usage, plus Heavy — our smartest model.",
};
const MEGA: RecommendedPlan = {
  id: "mega",
  name: "Mega",
  priceUsd: 30,
  blurb: "~7× Mini's usage, with Heavy along for all of it.",
};

function heroBadgeForFeature(feature: GateFeature): PlanId | null {
  switch (feature) {
    case "auto":
    case "can_search":
    case "basic":
    case "files":
    case "memory":
    case "mcp":
    case "skills":
    case "compact":
    case "priority":
    case "reasoning":
      return "mini";
    case "pro":
    case "max":
    case "image":
      return "turbo";
    case "usage":
    case "messages":
      return null;
  }
}

function copyFor(feature: GateFeature): {
  title: string;
  body: string;
  plans: RecommendedPlan[];
} {
  switch (feature) {
    case "usage":
      return {
        title: "You're out of usage",
        body: "Your pool ran dry. Load up extra usage to keep going now, or upgrade for a bigger weekly budget.",
        plans: [MINI, TURBO, MEGA],
      };
    case "messages":
      return {
        title: "You've used your free messages",
        body: "Free includes 15 messages per day. Upgrade to keep chatting with a weekly usage budget and better models.",
        plans: [MINI, TURBO, MEGA],
      };
    case "auto":
      return {
        title: "Auto is on paid plans",
        body: "Auto picks the best model for each question. The free plan sticks to the Free model — Mini and up unlock Auto.",
        plans: [MINI, TURBO, MEGA],
      };
    case "basic":
      return {
        title: "Fast is on paid plans",
        body: "Mini unlocks Fast — snappy answers for everyday questions.",
        plans: [MINI, TURBO, MEGA],
      };
    case "can_search":
      return {
        title: "Web search is on paid plans",
        body: "Any paid plan lets answers pull in fresh info from the web.",
        plans: [MINI, TURBO, MEGA],
      };
    case "files":
      return {
        title: "Larger uploads are on paid plans",
        body: "Free attachments are capped at 1 MB each. Any paid plan lifts the cap so you can attach bigger images and files.",
        plans: [MINI, TURBO, MEGA],
      };
    case "memory":
      return {
        title: "Memory is on paid plans",
        body: "Any paid plan lets Whirl remember the things you tell it, so future chats pick up where you left off.",
        plans: [MINI, TURBO, MEGA],
      };
    case "mcp":
      return {
        title: "MCP servers are on paid plans",
        body: "Any paid plan lets you connect your own tools so Whirl can act on them mid-chat.",
        plans: [MINI, TURBO, MEGA],
      };
    case "skills":
      return {
        title: "Skills are on paid plans",
        body: "Any paid plan lets you install skills — instruction packs Whirl picks up mid-chat, right when the task calls for them.",
        plans: [MINI, TURBO, MEGA],
      };
    case "compact":
      return {
        title: "Compaction is on paid plans",
        body: "Any paid plan can summarize long threads to free up room for more conversation.",
        plans: [MINI, TURBO, MEGA],
      };
    // Legacy sentinel — the Pro tier retired, but old gate messages still
    // carry it. Point those users at today's equivalent: Heavy on Turbo.
    case "pro":
    case "max":
      return {
        title: "Heavy lives on Turbo",
        body: "Turbo and up add Heavy — our most capable model, built for the hard stuff.",
        plans: [TURBO, MEGA],
      };
    case "image":
      return {
        title: "Image generation lives on Turbo",
        body: "Turbo and up can create and edit images right in the chat.",
        plans: [TURBO, MEGA],
      };
    case "reasoning":
      return {
        title: "Thinking is on paid plans",
        body: "Any paid plan lets the model slow down and work through tricky problems.",
        plans: [MINI, TURBO, MEGA],
      };
    case "priority":
      return {
        title: "Get priority access",
        body: "When demand spikes, free messages are the first to pause. Any paid plan gets priority access — plus a weekly usage budget and better models.",
        plans: [MINI, TURBO, MEGA],
      };
  }
}

type UpgradeContextValue = {
  open: (feature: GateFeature) => void;
};

const UpgradeContext = createContext<UpgradeContextValue | null>(null);

export function useUpgrade(): UpgradeContextValue {
  const ctx = useContext(UpgradeContext);
  if (!ctx) {
    return { open: () => undefined };
  }
  return ctx;
}

export function UpgradeProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const capture = useCapture();
  const openExtraUsage = useOpenExtraUsage();
  const [feature, setFeature] = useState<GateFeature | null>(null);

  const open = useCallback(
    (f: GateFeature) => {
      // Which gate nudged the user toward upgrading — the most useful slice
      // for understanding what actually drives upgrades.
      capture(ANALYTICS_EVENTS.upgradeModalOpened, { feature: f });
      setFeature(f);
    },
    [capture],
  );
  const close = useCallback(() => setFeature(null), []);

  const value = useMemo(() => ({ open }), [open]);

  const goToPricing = () => {
    close();
    void navigate({ to: "/pricing" });
  };

  const goToExtraUsage = () => {
    close();
    openExtraUsage();
  };

  return (
    <UpgradeContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {feature && (
          <motion.div
            key="upgrade-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={close}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          >
            <motion.div
              key="upgrade-card"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: "spring", stiffness: 360, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md"
            >
              <Squircle
                radius={12}
                className="overflow-hidden rounded-xl bg-gradient-to-b from-[#dcdcdc] to-[#c8c8c8] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.18),_0_0_0_1px_rgba(0,0,0,0.06)] dark:from-[#161616] dark:to-[#0a0a0a] dark:shadow-[0_20px_50px_rgba(0,0,0,0.4),_0_0_0_1px_rgba(0,0,0,0.4)]"
              >
                <UpgradeBody
                  feature={feature}
                  onClose={close}
                  onSeeAll={goToPricing}
                  onTopUp={goToExtraUsage}
                />
              </Squircle>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </UpgradeContext.Provider>
  );
}

function UpgradeBody({
  feature,
  onClose,
  onSeeAll,
  onTopUp,
}: {
  feature: GateFeature;
  onClose: () => void;
  onSeeAll: () => void;
  onTopUp: () => void;
}) {
  const { title, body, plans } = copyFor(feature);
  const heroPlan = heroBadgeForFeature(feature);
  const capture = useCapture();
  const { format, currency, isLocal } = useLocalCurrency();
  // Out of usage is a paid-only gate, so offer an instant top-up as the primary
  // action and keep the upgrade path as a secondary nudge.
  const canTopUp = feature === "usage";

  useEffect(() => {
    if (!isLocal) return;
    capture(ANALYTICS_EVENTS.planPricesLocalized, {
      currency,
      surface: "upgrade_modal",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocal]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full text-neutral-600 transition hover:bg-black/10 hover:text-neutral-900 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white/90"
      >
        <IconX size={14} stroke={2.25} />
      </button>

      <div className="flex h-[88px] items-center justify-center px-6">
        {heroPlan ? (
          <img
            src={`/plan-badges/${heroPlan}.svg`}
            alt={`${heroPlan} plan`}
            className="h-9 w-auto"
          />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/[0.08] text-amber-600 dark:bg-white/[0.08] dark:text-amber-300">
            <IconSparkles size={22} stroke={2} />
          </span>
        )}
      </div>

      <div className="rounded-[8px] bg-white p-5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.04)] dark:bg-[#1a1a1a] dark:shadow-[inset_0_1px_3px_rgba(0,0,0,0.35)]">
        <div className="text-center">
          <h2 className="text-[17px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            {title}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            {body}
          </p>
        </div>

        <div className="mt-5 space-y-2">
          {plans.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={onSeeAll}
              className="group flex w-full items-center gap-3 rounded-xl border border-black/[0.06] bg-black/[0.02] p-3 text-left transition hover:border-black/[0.1] hover:bg-black/[0.04] dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/[0.14] dark:hover:bg-white/[0.06]"
            >
              <span className="flex h-8 shrink-0 items-center justify-center">
                <img
                  src={`/plan-badges/${p.id}.svg`}
                  alt=""
                  className="h-5 w-auto brightness-0 opacity-70 transition group-hover:opacity-90 dark:opacity-80 dark:invert"
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-baseline gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
                  {p.name}
                  <span
                    className="text-[11px] font-normal text-neutral-500 dark:text-neutral-400"
                    title={isLocal ? `Billed as $${p.priceUsd} USD` : undefined}
                  >
                    {format(p.priceUsd)}/mo
                  </span>
                  {p.id === "turbo" && (
                    <span className="rounded-full bg-[#0c82f2]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#0c82f2] dark:bg-[#3b9bff]/15 dark:text-[#3b9bff]">
                      Most picked
                    </span>
                  )}
                </span>
                <span className="truncate text-[12px] text-neutral-500 dark:text-neutral-400">
                  {p.blurb}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={canTopUp ? onSeeAll : onClose}
            className="h-9 rounded-lg px-3 text-[13px] text-neutral-600 transition hover:bg-black/[0.04] dark:text-neutral-300 dark:hover:bg-white/[0.06]"
          >
            {canTopUp ? "See plans" : "Not now"}
          </button>
          <DepthButton
            variant="blue"
            type="button"
            onClick={canTopUp ? onTopUp : onSeeAll}
            className="inline-flex h-9 items-center rounded-lg px-3.5 text-[13px] font-medium text-white"
          >
            {canTopUp ? "Load up extra usage" : "See plans"}
          </DepthButton>
        </div>
      </div>
    </div>
  );
}

export const GATE_SENTINEL_PREFIX = "__AUTUMN_GATE__:";

export function parseGateSentinel(content: string | undefined): GateFeature | null {
  if (!content) return null;
  if (!content.startsWith(GATE_SENTINEL_PREFIX)) return null;
  const raw = content.slice(GATE_SENTINEL_PREFIX.length).trim();
  const allowed: GateFeature[] = ["usage", "messages", "can_search", "auto", "basic", "pro", "max", "reasoning", "files", "compact", "image"];
  return (allowed as string[]).includes(raw) ? (raw as GateFeature) : null;
}
