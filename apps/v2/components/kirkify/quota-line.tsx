"use client";

import type { KirkifyQuota } from "@/lib/kirkify/types";

function resetLabel(resetsAt: number): string {
  return new Date(resetsAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function plural(count: number): string {
  return count === 1 ? "Kirkify" : "Kirkifies";
}

function describe(quota: KirkifyQuota): { text: string; signIn: boolean } {
  if (quota.paid) {
    return { text: "Billed to your plan's usage.", signIn: false };
  }
  const at = resetLabel(quota.resetsAt);
  if (quota.signedIn) {
    const left = quota.remaining.total;
    return left > 0
      ? { text: `${left} ${plural(left)} left today.`, signIn: false }
      : { text: `None left today. Back at ${at}.`, signIn: false };
  }
  const left = quota.remaining.anonymous;
  return left > 0
    ? { text: `${left} free ${plural(left)} left today.`, signIn: true }
    : { text: `Today's three are used up. Back at ${at}.`, signIn: true };
}

/** What's left, and the one thing a visitor can do about it. */
export function QuotaLine({
  quota,
  onSignIn,
}: {
  quota: KirkifyQuota | null;
  onSignIn: () => void;
}) {
  const line = quota ? describe(quota) : null;
  return (
    <p className="min-h-5 text-[13px] text-neutral-500 dark:text-neutral-400">
      {line?.text}
      {line?.signIn && (
        <>
          {" "}
          <button
            type="button"
            onClick={onSignIn}
            className="cursor-pointer font-medium text-neutral-800 underline-offset-2 hover:underline dark:text-neutral-100"
          >
            Sign in for five more
          </button>
        </>
      )}
    </p>
  );
}
