import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCustomer, usePricingTable } from "autumn-js/react";
import { AnimatePresence, motion } from "motion/react";
import type { TablerIcon } from "@tabler/icons-react";
import {
  IconBarbell,
  IconBolt,
  IconBrain,
  IconCpu,
  IconFeather,
  IconPaperclip,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react";

import { WhirlLogo } from "~/components/whirl-logo";
import { Spinner } from "~/components/spinner";
import { useActiveMultiplier } from "~/lib/admin";
import { useLocalCurrency } from "~/lib/local-currency";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";
import { seo } from "~/lib/seo";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  // A public, indexable marketing page (it's in the sitemap), so give it its
  // own title, description, and canonical.
  head: () =>
    seo({
      title: "Plans & Pricing · Whirl",
      description:
        "See Whirl's plans and pricing — start free, then upgrade for more usage across the best AI models, with memory, living documents, and visualizations.",
      url: "/pricing",
    }),
});

type PlanId = "free" | "mini" | "turbo" | "mega";

type IconType = TablerIcon;

type Feature = { icon: IconType; label: string };

type PaidPlan = {
  id: Exclude<PlanId, "free">;
  name: string;
  badge: string;
  tagline: string;
  price: number;
  features: Feature[];
};

const PAID_PLANS: PaidPlan[] = [
  {
    id: "mini",
    name: "Mini",
    badge: "/plan-badges/mini.svg",
    tagline: "A daily-driver budget.",
    price: 5,
    features: [
      { icon: IconCpu, label: "Plenty for daily questions" },
      { icon: IconBolt, label: "Unlocks the Fast model" },
      { icon: IconBrain, label: "Thinking mode for hard problems" },
      { icon: IconPaperclip, label: "Larger file uploads" },
      { icon: IconSearch, label: "Live web search" },
    ],
  },
  {
    id: "turbo",
    name: "Turbo",
    badge: "/plan-badges/turbo.svg",
    tagline: "More room. Smarter answers.",
    price: 12,
    features: [
      { icon: IconCpu, label: "≈2.5× Mini's weekly usage" },
      { icon: IconBarbell, label: "Adds Heavy — our most capable model" },
      { icon: IconBrain, label: "Thinking mode for hard problems" },
      { icon: IconPaperclip, label: "Larger file uploads" },
      { icon: IconSearch, label: "Live web search" },
    ],
  },
  {
    id: "mega",
    name: "Mega",
    badge: "/plan-badges/mega.svg",
    tagline: "The whole toolbox.",
    price: 30,
    features: [
      { icon: IconCpu, label: "≈7× Mini's weekly usage" },
      { icon: IconBarbell, label: "Heavy, with room to run it all week" },
      { icon: IconBrain, label: "Thinking mode" },
      { icon: IconPaperclip, label: "Larger file uploads" },
      { icon: IconSearch, label: "Live web search" },
    ],
  },
];

const FREE_FEATURES: Feature[] = [
  { icon: IconSparkles, label: "15 free messages per day" },
  { icon: IconFeather, label: "The Free model only" },
  { icon: IconPaperclip, label: "File uploads up to 1 MB" },
];

type Scenario =
  | "active"
  | "scheduled"
  | "new"
  | "renew"
  | "upgrade"
  | "downgrade"
  | "cancel"
  | undefined;

function buttonLabel(scenario: Scenario, isFree: boolean): string {
  switch (scenario) {
    case "active":
      return "Current plan";
    case "scheduled":
      return "Scheduled";
    case "upgrade":
      return "Upgrade";
    case "downgrade":
      return isFree ? "Cancel subscription" : "Downgrade";
    case "renew":
      return "Renew";
    default:
      return isFree ? "Stay on Free" : "Subscribe";
  }
}

function ButtonContent({
  busy,
  spinnerClassName,
  children,
}: {
  busy: boolean;
  spinnerClassName?: string;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-flex h-full items-center justify-center">
      <AnimatePresence mode="wait" initial={false}>
        {busy ? (
          <motion.span
            key="spinner"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
            className="inline-flex"
          >
            <Spinner
              size={16}
              className={`text-blue-500 ${spinnerClassName ?? ""}`}
            />
          </motion.span>
        ) : (
          <motion.span
            key="label"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
            className="inline-flex"
          >
            {children}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function FeatureRow({ icon, label }: Feature) {
  const Glyph = icon;
  return (
    <li className="flex items-start gap-2.5 text-[13px] text-neutral-700 dark:text-neutral-200">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-black/[0.05] text-neutral-700 dark:bg-white/[0.08] dark:text-neutral-200">
        <Glyph size={12} stroke={2} />
      </span>
      <span className="leading-5">{label}</span>
    </li>
  );
}

function formatEndsIn(ms: number): string {
  if (ms <= 0) return "soon";
  const totalMinutes = Math.ceil(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function MultiplierCallout() {
  const event = useActiveMultiplier();
  if (!event || !event.headline) return null;
  const endsIn =
    event.expiresAt != null ? event.expiresAt - Date.now() : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="mb-6 flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[#0c82f2] to-[#0a6fd0] px-4 py-3 text-white"
    >
      <IconSparkles
        size={18}
        stroke={2}
        className="shrink-0 opacity-90"
      />
      <div className="min-w-0">
        <p className="text-[14px] font-semibold">{event.headline}</p>
        {event.subtext ? (
          <p className="text-[12px] opacity-90">{event.subtext}</p>
        ) : null}
      </div>
      {endsIn != null && endsIn > 0 ? (
        <span className="ml-auto shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-[12px] font-medium">
          Ends in {formatEndsIn(endsIn)}
        </span>
      ) : null}
    </motion.div>
  );
}

function PricingPage() {
  const navigate = useNavigate();
  const capture = useCapture();
  const { products, isLoading } = usePricingTable();
  const { checkout, attach, refetch } = useCustomer();
  const { format, currency, isLocal } = useLocalCurrency();
  const [busyPlan, setBusyPlan] = useState<PlanId | null>(null);
  const [confirmingPlan, setConfirmingPlan] = useState<{
    id: PlanId;
    name: string;
    action: "upgrade" | "downgrade" | "renew" | "cancel";
  } | null>(null);

  useEffect(() => {
    if (!isLocal) return;
    capture(ANALYTICS_EVENTS.planPricesLocalized, {
      currency,
      surface: "pricing_page",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocal]);

  type Product = NonNullable<typeof products>[number];
  const productById = new Map<string, Product>();
  for (const p of products ?? []) productById.set(p.id, p);

  const handleClick = async (planId: PlanId) => {
    setBusyPlan(planId);
    capture(ANALYTICS_EVENTS.planCheckoutStarted, {
      plan: planId,
      scenario: productById.get(planId)?.scenario,
    });
    try {
      const result = await checkout({ productId: planId });
      const url = (result as { data?: { url?: string | null } })?.data?.url;
      if (url) {
        window.location.href = url;
        return;
      }
      const product = productById.get(planId);
      const scenario = product?.scenario as Scenario;
      setConfirmingPlan({
        id: planId,
        name: product?.name ?? planId,
        action:
          scenario === "downgrade"
            ? planId === "free"
              ? "cancel"
              : "downgrade"
            : scenario === "renew"
              ? "renew"
              : "upgrade",
      });
    } finally {
      setBusyPlan(null);
    }
  };

  const confirmAttach = async () => {
    if (!confirmingPlan) return;
    setBusyPlan(confirmingPlan.id);
    try {
      await attach({ productId: confirmingPlan.id });
      await refetch();
      setConfirmingPlan(null);
    } finally {
      setBusyPlan(null);
    }
  };

  const freeProduct = productById.get("free");
  const freeScenario = freeProduct?.scenario as Scenario;
  const isFreeCurrent = freeScenario === "active";
  const freeLabel = buttonLabel(freeScenario, true);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10 text-neutral-900 dark:text-neutral-100 sm:px-10 sm:py-14">
      <header className="mb-10 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Pricing
          </h1>
          <p className="mt-2 max-w-lg text-[14px] text-neutral-500 dark:text-neutral-400">
            One pool of usage, four ways to tap it. Upgrade, downgrade, or
            bail any time — proration sorts itself out.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void navigate({ to: "/" })}
          aria-label="Back to Whirl"
          className="shrink-0"
        >
          <WhirlLogo size={36} />
        </button>
      </header>

      <MultiplierCallout />

      {isLoading && !products ? (
        <div className="flex h-48 items-center justify-center">
          <Spinner size={16} className="text-blue-500" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {PAID_PLANS.map((plan, i) => {
              const product = productById.get(plan.id);
              const scenario = product?.scenario as Scenario;
              const isCurrent = scenario === "active";
              const label = buttonLabel(scenario, false);
              const disabled =
                isCurrent ||
                scenario === "scheduled" ||
                busyPlan !== null;

              return (
                <motion.div
                  key={plan.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, delay: i * 0.05 }}
                  className={`relative flex flex-col rounded-xl bg-gradient-to-b from-[#dcdcdc] to-[#c8c8c8] p-2 shadow-[0_2px_10px_rgba(0,0,0,0.08),_0_0_0_1px_rgba(0,0,0,0.06)] dark:from-[#161616] dark:to-[#0a0a0a] dark:shadow-[0_2px_10px_rgba(0,0,0,0.18),_0_0_0_1px_rgba(0,0,0,0.4)] ${
                    plan.id === "turbo"
                      ? "ring-2 ring-[#0c82f2]/50 dark:ring-[#3b9bff]/40"
                      : ""
                  }`}
                >
                  {plan.id === "turbo" && (
                    <span className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#0c82f2] px-3 py-1 text-[11px] font-semibold text-white shadow-[0_2px_8px_rgba(12,130,242,0.4)]">
                      Most picked
                    </span>
                  )}
                  <div className="flex h-20 items-center justify-center px-4">
                    <img
                      src={plan.badge}
                      alt={`${plan.name} plan`}
                      className="h-12 w-auto"
                    />
                  </div>

                  <div className="flex flex-1 flex-col rounded-[8px] bg-white p-5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.04)] dark:bg-[#1a1a1a] dark:shadow-[inset_0_1px_3px_rgba(0,0,0,0.35)]">
                    <h2 className="text-[17px] font-semibold tracking-tight">
                      {plan.tagline}
                    </h2>

                    <ul className="mt-4 flex-1 space-y-2.5">
                      {plan.features.map((f) => (
                        <FeatureRow key={f.label} {...f} />
                      ))}
                    </ul>

                    <div className="mt-6 flex items-baseline gap-1.5">
                      <span
                        className="text-4xl font-semibold tracking-tight"
                        title={isLocal ? `Billed as $${plan.price} USD` : undefined}
                      >
                        {format(plan.price)}
                      </span>
                      <span className="text-[13px] text-neutral-500 dark:text-neutral-400">
                        a month
                      </span>
                    </div>

                    <motion.button
                      whileTap={isCurrent ? undefined : { scale: 0.98 }}
                      type="button"
                      onClick={() => void handleClick(plan.id)}
                      disabled={disabled || !product}
                      className={`mt-4 inline-flex h-10 items-center justify-center rounded-xl text-[13px] font-medium transition disabled:opacity-60 ${
                        isCurrent
                          ? "cursor-default bg-black/[0.04] text-neutral-500 dark:bg-white/[0.06] dark:text-neutral-400"
                          : "depth-blue text-white"
                      }`}
                    >
                      <ButtonContent busy={busyPlan === plan.id}>
                        {label}
                      </ButtonContent>
                    </motion.button>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: 0.18 }}
            className="mx-auto mt-4 flex w-full max-w-sm flex-col rounded-xl bg-gradient-to-b from-[#dcdcdc] to-[#c8c8c8] p-2 shadow-[0_2px_10px_rgba(0,0,0,0.08),_0_0_0_1px_rgba(0,0,0,0.06)] dark:from-[#161616] dark:to-[#0a0a0a] dark:shadow-[0_2px_10px_rgba(0,0,0,0.18),_0_0_0_1px_rgba(0,0,0,0.4)]"
          >
            <div className="flex h-14 items-center justify-center">
              <span className="rounded-full bg-black/[0.06] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.18em] text-neutral-700 dark:bg-white/[0.08] dark:text-white/90">
                Free
              </span>
            </div>
            <div className="flex flex-col items-center rounded-[8px] bg-white p-5 text-center dark:bg-[#1a1a1a]">
              <h2 className="text-[17px] font-semibold tracking-tight">
                Just curious? Start here.
              </h2>
              <ul className="mt-3 space-y-2.5 text-left">
                {FREE_FEATURES.map((f) => (
                  <FeatureRow key={f.label} {...f} />
                ))}
              </ul>
              <div className="mt-5 flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight">
                  {format(0)}
                </span>
                <span className="text-[13px] text-neutral-500 dark:text-neutral-400">
                  forever
                </span>
              </div>
              <motion.button
                whileTap={isFreeCurrent ? undefined : { scale: 0.98 }}
                type="button"
                onClick={() => {
                  if (isFreeCurrent) return;
                  void handleClick("free");
                }}
                disabled={isFreeCurrent || busyPlan !== null || !freeProduct}
                className={`mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl text-[13px] font-medium transition disabled:opacity-60 ${
                  isFreeCurrent
                    ? "cursor-default bg-black/[0.04] text-neutral-500 dark:bg-white/[0.06] dark:text-neutral-400"
                    : "depth-neutral text-neutral-900 dark:text-neutral-100"
                }`}
              >
                <ButtonContent busy={busyPlan === "free"}>
                  {freeLabel}
                </ButtonContent>
              </motion.button>
            </div>
          </motion.div>

          {isLocal && (
            <p className="mt-6 text-center text-[12px] text-neutral-500 dark:text-neutral-400">
              Prices shown in {currency} are approximate, based on current
              exchange rates. Billing is in US dollars.
            </p>
          )}
        </>
      )}

      {typeof document !== "undefined" &&
        confirmingPlan &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && busyPlan === null) {
                setConfirmingPlan(null);
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.12 }}
              className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#1a1a1a]"
            >
              <h2 className="text-[15px] font-semibold">
                {confirmingPlan.action === "upgrade" && "Upgrade plan?"}
                {confirmingPlan.action === "downgrade" && "Switch plan?"}
                {confirmingPlan.action === "renew" && "Renew subscription?"}
                {confirmingPlan.action === "cancel" && "Cancel subscription?"}
              </h2>
              <p className="mt-2 text-[13px] text-neutral-500 dark:text-neutral-400">
                {confirmingPlan.action === "cancel"
                  ? "You'll move to the Free plan at the end of this cycle. You can resubscribe any time."
                  : `You'll move to ${confirmingPlan.name}. Billing is prorated automatically.`}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingPlan(null)}
                  className="h-9 rounded-lg px-3 text-[13px] text-neutral-600 hover:bg-black/[0.04] dark:text-neutral-300 dark:hover:bg-white/[0.06]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmAttach()}
                  disabled={busyPlan !== null}
                  className="h-9 rounded-lg bg-neutral-900 px-3 text-[13px] font-medium text-white hover:bg-neutral-800 disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                >
                  <ButtonContent busy={busyPlan !== null}>Confirm</ButtonContent>
                </button>
              </div>
            </motion.div>
          </div>,
          document.body,
        )}
    </div>
  );
}
