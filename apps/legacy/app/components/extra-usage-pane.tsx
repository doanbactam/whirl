import { useNavigate } from "@tanstack/react-router";
import { useUser } from "@clerk/tanstack-react-start";
import { useCustomer } from "autumn-js/react";
import { IconSparkles, IconWallet } from "@tabler/icons-react";

import { ExtraUsagePaneSkeleton } from "~/components/settings-skeletons";
import { ExtraUsageActivity } from "~/components/extra-usage/extra-usage-activity";
import { TopUpCard } from "~/components/extra-usage/topup-card";
import { formatUsd } from "~/lib/money";
import { readExtraUsage } from "~/lib/extra-usage";

/**
 * Settings → Extra Usage. Paid customers can top up their separate extra-usage
 * bucket (spent only after the plan's included usage runs out) and see what
 * recent replies cost in real dollars. Free customers get a nudge to upgrade,
 * since extra usage is a paid-only perk.
 */
export function ExtraUsagePane({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { isSignedIn } = useUser();
  const { customer, isLoading } = useCustomer();
  const { isPaid, balance, unlimited } = readExtraUsage(customer);

  const goToPricing = () => {
    onClose();
    void navigate({ to: "/pricing" });
  };

  // Signed in + no customer = still loading (or a retrying fetch) — don't
  // flash the free-plan upsell at paid users.
  if (!customer && (isLoading || isSignedIn)) {
    return <ExtraUsagePaneSkeleton />;
  }

  if (!isPaid) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-black/[0.1] px-6 py-10 text-center dark:border-white/[0.1]">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/[0.05] text-neutral-700 dark:bg-white/[0.06] dark:text-neutral-200">
          <IconWallet size={20} stroke={2} />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
            Extra usage is a paid perk
          </span>
          <p className="mx-auto max-w-xs text-[12.5px] text-neutral-500 dark:text-neutral-400">
            Upgrade to a paid plan, then top up here any time you run low — credit
            never expires.
          </p>
        </div>
        <button
          type="button"
          onClick={goToPricing}
          className="mt-1 inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-[13px] font-medium text-white outline-none transition hover:bg-blue-500"
        >
          <IconSparkles size={15} stroke={2} />
          See plans
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-4 pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
            Extra usage balance
          </span>
          <span className="text-[26px] font-semibold leading-none tracking-tight tabular-nums text-neutral-900 dark:text-neutral-100">
            {formatUsd(balance)}
          </span>
          <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
            {balance > 0
              ? "Spent automatically once your plan's usage runs out."
              : "Top up to keep going after your plan's usage runs out."}
          </span>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-neutral-700 dark:bg-white/[0.06] dark:text-neutral-200">
          <IconWallet size={18} stroke={2} />
        </span>
      </div>

      {unlimited ? (
        <div className="rounded-xl border border-black/[0.06] bg-black/[0.015] p-4 text-[12.5px] text-neutral-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-neutral-400">
          Your plan includes unlimited usage, so there's nothing to top up.
        </div>
      ) : (
        <TopUpCard />
      )}

      <ExtraUsageActivity
        onSelect={(threadId) => {
          onClose();
          void navigate({ to: `/thread/${threadId}` });
        }}
      />
    </div>
  );
}
