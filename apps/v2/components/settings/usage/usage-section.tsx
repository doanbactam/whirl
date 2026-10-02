"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { IconLogin2 } from "@tabler/icons-react";

import { AuthModal } from "@/components/auth/auth-modal";
import { Button } from "@/components/ui/button";
import { useDeploymentFeatures } from "@/lib/deployment-features";
import { useRecentUsage } from "@/lib/usage-data";
import { SettingsCard, SettingsHeader, SettingsRow } from "../settings-rows";
import { ModelMixCard } from "./model-mix-card";
import { UsagePoolCard } from "./usage-pool-card";
import { UsageTable } from "./usage-table";
import { UsageTrendCard } from "./usage-trend-card";

/* The usage tab: the wireframe's three panels — model mix donut on the
   left, pool bar + pace forecast stacked on the right — with the full
   request ledger underneath. */
export function UsageSection() {
  const { user, isLoaded } = useUser();
  const rows = useRecentUsage(200);
  const [authOpen, setAuthOpen] = useState(false);
  const { billing } = useDeploymentFeatures();

  if (isLoaded && !user) {
    return (
      <>
        <SettingsHeader
          title="Usage"
          description="Where every token went, and how much runway is left."
        />
        <SettingsCard>
          <SettingsRow
            icon={IconLogin2}
            title="You're signed out"
            description="Sign in to see your usage."
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

  return (
    <>
      <SettingsHeader
        title="Usage"
        description="Where every token went, and how much runway is left."
      />
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <ModelMixCard rows={rows} />
          <div className="flex flex-col gap-4">
            {/* The pool is a plan's allowance; without billing there isn't one. */}
            {billing && <UsagePoolCard />}
            <UsageTrendCard rows={rows} />
          </div>
        </div>
        <UsageTable rows={rows} />
      </div>
    </>
  );
}
