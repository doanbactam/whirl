"use client";

import { useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { IconCheck } from "@tabler/icons-react";
import { useCustomer, usePricingTable } from "autumn-js/react";

import { AuthModal } from "@/components/auth/auth-modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { captureCheckoutStarted } from "@/lib/funnel";
import { findActivePlanProduct } from "@/lib/plan";
import { showToast } from "@/lib/toasts";
import { cn } from "@/lib/utils";
import {
  PLAN_DEFINITIONS,
  type PlanDefinition,
  type PricingPlanId,
} from "./plan-catalog";
import { PlanMark } from "./plan-mark";

type Scenario =
  | "active"
  | "scheduled"
  | "new"
  | "renew"
  | "upgrade"
  | "downgrade"
  | undefined;

type PendingChange = {
  plan: PlanDefinition;
  action: "upgrade" | "downgrade" | "renew" | "cancel";
};

function actionLabel(scenario: Scenario, planId: PricingPlanId) {
  if (scenario === "active") return "Current plan";
  if (scenario === "scheduled") return "Scheduled";
  if (scenario === "renew") return "Renew";
  if (scenario === "downgrade")
    return planId === "free" ? "Move to Free" : "Downgrade";
  if (scenario === "upgrade") return "Upgrade";
  return planId === "free" ? "Start free" : "Choose plan";
}

function PlanCard({
  plan,
  scenario,
  busy,
  compact,
  onChoose,
}: {
  plan: PlanDefinition;
  scenario: Scenario;
  busy: boolean;
  compact: boolean;
  onChoose: () => void;
}) {
  const disabled = busy || scenario === "active" || scenario === "scheduled";
  const featured = plan.id === "turbo";

  return (
    <article
      className={cn(
        "relative flex min-w-0 flex-col rounded-2xl bg-surface p-5 ring-1 ring-border",
        featured && "ring-2 ring-foreground/25",
        compact && "p-4",
      )}
    >
      {featured && !compact && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground">
          Most picked
        </span>
      )}
      <div className="flex h-11 items-center">
        <PlanMark plan={plan.id} large />
      </div>
      <h2 className="mt-3 text-base font-semibold tracking-tight">
        {plan.tagline}
      </h2>
      <p className="mt-1 text-[13px]/5 text-muted-foreground">
        {plan.description}
      </p>
      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tracking-tight">
          ${plan.price}
        </span>
        <span className="text-[12px] text-muted-foreground">
          {plan.price === 0 ? "forever" : "USD / month"}
        </span>
      </div>
      {!compact && (
        <ul className="mt-5 flex flex-1 flex-col gap-2.5">
          {plan.features.map(({ label }) => (
            <li
              key={label}
              className="flex gap-2 text-[13px]/5 text-foreground/85"
            >
              <IconCheck
                size={15}
                stroke={2.2}
                className="mt-0.5 shrink-0 text-muted-foreground"
              />
              {label}
            </li>
          ))}
        </ul>
      )}
      <Button
        size="lg"
        variant={featured && !disabled ? "default" : "secondary"}
        className="mt-5 w-full"
        disabled={disabled}
        onClick={onChoose}
      >
        {busy ? "Working on it…" : actionLabel(scenario, plan.id)}
      </Button>
    </article>
  );
}

export function PlanPicker({
  compact = false,
  includeFree = true,
  onComplete,
}: {
  compact?: boolean;
  includeFree?: boolean;
  onComplete?: () => void;
}) {
  const { user, isLoaded: userLoaded } = useUser();
  const {
    products,
    isLoading,
    error,
    refetch: refetchPrices,
  } = usePricingTable();
  const { customer, checkout, attach, refetch } = useCustomer();
  const [busyPlan, setBusyPlan] = useState<PricingPlanId | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(
    null,
  );
  const [authOpen, setAuthOpen] = useState(false);

  const productById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  );
  const activePlan = user
    ? (findActivePlanProduct(customer)?.id ?? "free")
    : null;
  const plans = includeFree
    ? PLAN_DEFINITIONS
    : PLAN_DEFINITIONS.filter((plan) => plan.id !== "free");

  const choosePlan = async (plan: PlanDefinition) => {
    if (!userLoaded) return;
    if (!user) {
      setAuthOpen(true);
      return;
    }

    const product = productById.get(plan.id);
    if (!product) {
      showToast("That plan isn't available right now. Try again shortly.");
      return;
    }

    setBusyPlan(plan.id);
    try {
      const result = await checkout({ productId: plan.id });
      const url = (result as { data?: { url?: string | null } })?.data?.url;
      if (url) {
        // Capture before the page is handed to Stripe — after `assign` there's
        // no telling how much of this document still exists.
        captureCheckoutStarted(plan.id, "stripe");
        window.location.assign(url);
        return;
      }

      const scenario = product.scenario as Scenario;
      setPendingChange({
        plan,
        action:
          scenario === "downgrade"
            ? plan.id === "free"
              ? "cancel"
              : "downgrade"
            : scenario === "renew"
              ? "renew"
              : "upgrade",
      });
    } catch {
      showToast("Couldn't start checkout. Try again.");
    } finally {
      setBusyPlan(null);
    }
  };

  const confirmChange = async () => {
    if (!pendingChange) return;
    const change = pendingChange;
    setBusyPlan(change.plan.id);
    if (change.action !== "cancel") {
      captureCheckoutStarted(change.plan.id, "in_app");
    }
    try {
      await attach({ productId: change.plan.id });
      showToast(
        change.plan.id === "free"
          ? "Your move to Free is scheduled."
          : `You're moving to ${change.plan.name}.`,
      );
      setPendingChange(null);
      try {
        await refetch();
        refetchPrices();
      } catch {
        // The subscription succeeded; fresh data will arrive on its own.
      }
      onComplete?.();
    } catch {
      showToast("Couldn't change your plan. Try again.");
    } finally {
      setBusyPlan(null);
    }
  };

  if ((!userLoaded || (user && isLoading)) && !products) {
    return (
      <div
        className={cn(
          "grid gap-3",
          compact ? "sm:grid-cols-3" : "md:grid-cols-2 xl:grid-cols-4",
        )}
      >
        {plans.map((plan) => (
          <Skeleton key={plan.id} className="h-64 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (user && error && !products) {
    return (
      <div className="rounded-2xl bg-surface p-6 text-center ring-1 ring-border">
        <p className="text-sm font-medium">Pricing took a wrong turn.</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Nothing was charged. Give it another go.
        </p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => refetchPrices()}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "grid gap-3",
          compact ? "sm:grid-cols-3" : "md:grid-cols-2 xl:grid-cols-4",
        )}
      >
        {plans.map((plan) => {
          const product = productById.get(plan.id);
          const scenario =
            (product?.scenario as Scenario) ??
            (activePlan === plan.id ? "active" : undefined);
          return (
            <PlanCard
              key={plan.id}
              plan={plan}
              scenario={scenario}
              busy={busyPlan === plan.id}
              compact={compact}
              onChoose={() => void choosePlan(plan)}
            />
          );
        })}
      </div>

      <ConfirmDialog
        open={pendingChange !== null}
        onOpenChange={(open) => {
          if (!open && busyPlan === null) setPendingChange(null);
        }}
        title={
          pendingChange?.action === "cancel"
            ? "Move to the Free plan?"
            : `Switch to ${pendingChange?.plan.name ?? "this plan"}?`
        }
        message={
          pendingChange?.action === "cancel"
            ? "Your paid access continues until the end of this billing period."
            : "Autumn will prorate the change automatically. Your new allowance will appear as soon as it is ready."
        }
        confirmLabel={
          pendingChange?.action === "cancel" ? "Move to Free" : "Confirm switch"
        }
        destructive={pendingChange?.action === "cancel"}
        onConfirm={() => void confirmChange()}
      />
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </>
  );
}
