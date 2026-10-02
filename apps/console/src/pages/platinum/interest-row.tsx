import { useState } from "react";
import {
  IconAlertTriangleFilled,
  IconCircleCheckFilled,
  IconCopy,
} from "@tabler/icons-react";

import { Spinner } from "~/components/spinner";
import type { PlatinumInterest } from "~/lib/backend";
import { formatDate } from "~/lib/format";

const STATUS_BADGES: Record<PlatinumInterest["status"], string> = {
  pending: "bg-amber-500/[0.12] text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300",
  declined: "bg-black/[0.05] text-neutral-500 dark:bg-white/[0.07]",
};

const STATUS_LABELS: Record<PlatinumInterest["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
};

/**
 * One request. Approving mints a Stripe checkout link for that customer and
 * emails it to them; if the email fails the approval still stands and the
 * link is shown here so it can be handed over by other means.
 */
export function InterestRow({
  request,
  onApprove,
  onDecline,
}: {
  request: PlatinumInterest;
  onApprove: () => Promise<void>;
  onDecline: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async (kind: "approve" | "decline", action: () => Promise<void>) => {
    setError(null);
    setBusy(kind);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async () => {
    if (!request.checkoutUrl) return;
    try {
      await navigator.clipboard.writeText(request.checkoutUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Couldn't reach the clipboard. Copy the link manually.");
    }
  };

  return (
    <li className="rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/[0.06] dark:bg-[#1B1B1B]">
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
            {request.name ?? request.email}
          </span>
          <span className="truncate text-[12px] text-neutral-500 dark:text-neutral-400">
            {request.name ? `${request.email} · ` : ""}
            {request.planName} · {formatDate(request.createdAt)}
          </span>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGES[request.status]}`}
        >
          {STATUS_LABELS[request.status]}
        </span>
      </div>

      {request.status === "approved" && (
        <p className="mt-3 flex items-start gap-1.5 text-[12px]/5">
          {request.emailError ? (
            <>
              <IconAlertTriangleFilled
                size={13}
                className="mt-0.5 shrink-0 text-amber-500"
              />
              <span className="text-amber-700 dark:text-amber-300">
                Link created, email failed: {request.emailError}
              </span>
            </>
          ) : (
            <>
              <IconCircleCheckFilled
                size={13}
                className="mt-0.5 shrink-0 text-emerald-500"
              />
              <span className="text-neutral-500 dark:text-neutral-400">
                Emailed to {request.email}
                {request.emailedAt ? ` on ${formatDate(request.emailedAt)}` : ""}
              </span>
            </>
          )}
        </p>
      )}

      {error && (
        <p className="mt-3 text-[12.5px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mt-3.5 flex items-center gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run("approve", onApprove)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[12.5px] font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
        >
          {busy === "approve" && <Spinner size={12} />}
          {busy === "approve"
            ? "Sending…"
            : request.status === "approved"
              ? "Re-send invite"
              : "Approve & email"}
        </button>
        {request.status !== "declined" && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run("decline", onDecline)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-neutral-500 transition hover:bg-black/[0.05] hover:text-neutral-800 disabled:opacity-60 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-neutral-100"
          >
            {busy === "decline" && <Spinner size={12} />}
            Decline
          </button>
        )}
        {request.checkoutUrl && (
          <button
            type="button"
            onClick={() => void copyLink()}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-neutral-500 transition hover:bg-black/[0.05] hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-neutral-100"
          >
            <IconCopy size={13} stroke={2} />
            {copied ? "Copied" : "Copy link"}
          </button>
        )}
      </div>
    </li>
  );
}
