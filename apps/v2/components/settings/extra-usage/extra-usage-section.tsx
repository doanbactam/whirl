"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { IconCoinFilled, IconLogin2 } from "@tabler/icons-react";
import { useCustomer } from "autumn-js/react";

import { AuthModal } from "@/components/auth/auth-modal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { readExtraUsage } from "@/lib/extra-usage";
import { formatUsd } from "@/lib/money";
import { useRecentUsage } from "@/lib/usage-data";
import { UsageMeter } from "../../usage-meter";
import { SettingsCard, SettingsHeader, SettingsRow } from "../settings-rows";
import { ExtraUsageActivity } from "./extra-usage-activity";
import { TopUpCard } from "./topup-card";

/* The extra-usage tab, ported from v1's settings modal: balance at the top,
   the top-up flow, and the ledger of requests the bucket has covered. */
export function ExtraUsageSection() {
  const { user, isLoaded } = useUser();
  const { customer, isLoading } = useCustomer();
  const rows = useRecentUsage(200);
  const [authOpen, setAuthOpen] = useState(false);

  const header = (
    <SettingsHeader
      title="Extra usage"
      description="A dollar bucket that catches you when the plan runs dry."
    />
  );

  /* Signed in + no customer yet = Autumn still loading, not a free plan. */
  const loading = !isLoaded || (!customer && (isLoading || !!user));
  if (loading) {
    return (
      <>
        {header}
        <SettingsCard>
          <div className="p-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-3 h-7 w-28" />
            <Skeleton className="mt-3 h-1.5 w-full rounded-full" />
          </div>
        </SettingsCard>
      </>
    );
  }

  if (!user) {
    return (
      <>
        {header}
        <SettingsCard>
          <SettingsRow
            icon={IconLogin2}
            title="You're signed out"
            description="Sign in to see and top up your extra usage."
            control={
              <Button variant="secondary" onClick={() => setAuthOpen(true)}>
                Sign in
              </Button>
            }
          />
        </SettingsCard>
        <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
      </>
    );
  }

  const extra = readExtraUsage(customer);

  if (extra.unlimited) {
    return (
      <>
        {header}
        <SettingsCard>
          <SettingsRow
            icon={IconCoinFilled}
            title="You're unlimited"
            description="Your plan has no usage cap, so there's nothing extra to buy. Nice."
          />
        </SettingsCard>
      </>
    );
  }

  if (!extra.isPaid) {
    return (
      <>
        {header}
        <SettingsCard>
          <SettingsRow
            icon={IconCoinFilled}
            title="A paid-plan perk"
            description="Extra usage tops up a plan's included pool — pick a plan first, then you can load up a balance that never expires."
          />
        </SettingsCard>
      </>
    );
  }

  const meterPct =
    extra.included > 0 ? (extra.balance / extra.included) * 100 : 0;

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <SettingsCard>
          <div className="p-4">
            <span className="text-sm font-medium">Balance</span>
            <div className="mt-2 text-2xl/8 font-semibold tabular-nums tracking-tight">
              {formatUsd(extra.balance)}
            </div>
            {extra.included > 0 ? (
              <>
                <UsageMeter remainingPct={meterPct} className="mt-3" />
                <p className="mt-2 text-[13px]/[18px] text-muted-foreground">
                  {formatUsd(extra.used)} spent of {formatUsd(extra.included)}{" "}
                  added all-time. It never expires.
                </p>
              </>
            ) : (
              <p className="mt-1 text-[13px]/[18px] text-muted-foreground">
                Nothing loaded yet — top up below and it&apos;ll wait
                patiently.
              </p>
            )}
          </div>
        </SettingsCard>

        <TopUpCard />

        <ExtraUsageActivity rows={rows} />
      </div>
    </>
  );
}
