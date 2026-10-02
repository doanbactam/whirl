"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { IconArrowUpRight, IconLogin2 } from "@tabler/icons-react";
import { useCustomer } from "autumn-js/react";

import { AuthModal } from "@/components/auth/auth-modal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UpgradeDialog } from "@/components/pricing/upgrade-dialog";
import { findActivePlanProduct, type PlanId } from "@/lib/plan";
import { showToast } from "@/lib/toasts";
import { ConfirmDialog } from "../confirm-dialog";
import { PlanBadge } from "../plan-badge";
import { SettingsCard, SettingsHeader, SettingsRow } from "./settings-rows";
import { UsageCard } from "./usage-card";

const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export function BillingSection() {
  const { user, isLoaded } = useUser();
  const { customer, openBillingPortal, cancel, refetch, isLoading } =
    useCustomer();
  const [busy, setBusy] = useState<"portal" | "cancel" | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const activeProduct = findActivePlanProduct(customer);
  const isPaid = !!activeProduct;
  const scheduledCancel = !!activeProduct?.canceled_at;
  const periodEnd = activeProduct?.current_period_end ?? null;
  const trialEnd = activeProduct?.trial_ends_at ?? null;
  const status = activeProduct?.status;

  const statusLabel = scheduledCancel
    ? "Canceling"
    : status === "trialing"
      ? "Trial"
      : status === "past_due"
        ? "Past due"
        : isPaid
          ? "Active"
          : "Free";

  const planSubline =
    scheduledCancel && periodEnd
      ? `Ends ${dateLabel(periodEnd)}`
      : trialEnd
        ? `Trial ends ${dateLabel(trialEnd)}`
        : isPaid && periodEnd
          ? `Renews ${dateLabel(periodEnd)}`
          : !isPaid
            ? "You're on the free plan."
            : null;

  const openPortal = async () => {
    setBusy("portal");
    try {
      const res = await openBillingPortal({ returnUrl: window.location.href });
      const url = (res as { data?: { url?: string | null } })?.data?.url;
      if (url) window.location.href = url;
      else showToast("Couldn't open the billing portal. Try again.");
    } catch {
      showToast("Couldn't open the billing portal. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const cancelPlan = async () => {
    if (!activeProduct) return;
    setBusy("cancel");
    try {
      await cancel({ productId: activeProduct.id });
      await refetch();
    } catch {
      showToast("Couldn't cancel the subscription. Try again.");
    } finally {
      setBusy(null);
    }
  };

  /* Signed in + no customer yet = Autumn still loading, not a free plan. */
  const loading = !isLoaded || (!customer && (isLoading || !!user));

  return (
    <>
      <SettingsHeader
        title="Billing"
        description="Your plan, your usage, and the bill."
      />
      {loading ? (
        <SettingsCard>
          <div className="p-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-3 h-4 w-32" />
            <Skeleton className="mt-2 h-3 w-40" />
          </div>
        </SettingsCard>
      ) : !user ? (
        <SettingsCard>
          <SettingsRow
            icon={IconLogin2}
            title="You're signed out"
            description="Sign in to see your plan and manage billing."
            control={
              <Button variant="secondary" onClick={() => setAuthOpen(true)}>
                Sign in
              </Button>
            }
          />
        </SettingsCard>
      ) : (
        <div className="flex flex-col gap-4">
          <SettingsCard>
            <div className="p-4">
              <div className="text-sm font-medium">Current plan</div>
              <div className="mt-2 flex items-center gap-2.5">
                {activeProduct ? (
                  <PlanBadge
                    plan={activeProduct.id as PlanId}
                    className="h-4 w-auto"
                  />
                ) : (
                  <span className="text-lg/6 font-semibold tracking-tight">
                    Free
                  </span>
                )}
                <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[11px]/4 font-semibold text-muted-foreground dark:bg-white/[0.08]">
                  {statusLabel}
                </span>
              </div>
              {planSubline && (
                <p className="mt-1.5 text-[13px]/[18px] text-muted-foreground">
                  {planSubline}
                </p>
              )}
            </div>
          </SettingsCard>

          <UsageCard />

          <SettingsCard>
            <SettingsRow
              icon={IconArrowUpRight}
              title={isPaid ? "Change plan" : "Upgrade your plan"}
              description={
                isPaid
                  ? "Compare plans and switch without leaving Whirl."
                  : "Unlock more models, larger uploads, and more room to think."
              }
              control={
                <Button onClick={() => setUpgradeOpen(true)}>
                  {isPaid ? "Compare plans" : "View plans"}
                </Button>
              }
            />
            <SettingsRow
              title="Manage billing"
              description="Open the Stripe portal to update payment methods, view invoices, and download receipts."
              control={
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => void openPortal()}
                >
                  {busy === "portal" ? "Opening…" : "Manage billing"}
                </Button>
              }
            />
            {isPaid && !scheduledCancel && (
              <SettingsRow
                title="Cancel subscription"
                description={
                  periodEnd
                    ? `You'll keep access until ${dateLabel(periodEnd)}.`
                    : "You'll keep access until the end of the current period."
                }
                control={
                  <Button
                    variant="destructive"
                    disabled={busy !== null}
                    onClick={() => setConfirmingCancel(true)}
                  >
                    {busy === "cancel" ? "Canceling…" : "Cancel"}
                  </Button>
                }
              />
            )}
          </SettingsCard>
        </div>
      )}
      <ConfirmDialog
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
        title="Cancel your subscription?"
        message={
          periodEnd
            ? `You'll keep access until ${dateLabel(periodEnd)}, then drop to the free plan.`
            : "You'll keep access until the end of the current period, then drop to the free plan."
        }
        confirmLabel="Cancel subscription"
        destructive
        onConfirm={() => void cancelPlan()}
      />
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </>
  );
}
