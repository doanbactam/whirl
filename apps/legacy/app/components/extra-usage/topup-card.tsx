import { useState } from "react";
import { useCustomer } from "autumn-js/react";
import { AnimatePresence, motion } from "motion/react";
import { IconPlus } from "@tabler/icons-react";

import { Spinner } from "~/components/spinner";
import { showToast } from "~/data/toasts";
import { formatUsd } from "~/lib/money";
import {
  clampTopupAmount,
  EXTRA_USAGE_FEATURE_ID,
  EXTRA_USAGE_PRODUCT_ID,
  MAX_TOPUP_USD,
  MIN_TOPUP_USD,
  TOPUP_PRESETS,
} from "~/lib/extra-usage";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

type AmountSelection = { mode: "preset" | "custom"; amount: number };

/**
 * Lets a paid customer top up their separate extra-usage bucket by buying the
 * one-off `extra_usage` product ($1 per credit) — spent only after their plan's
 * included usage runs out. Mirrors the pricing page's checkout flow: try
 * `checkout` (redirect to Stripe when a URL comes back), otherwise confirm and
 * `attach` against the card on file.
 */
export function TopUpCard({ onPurchased }: { onPurchased?: () => void }) {
  const { checkout, attach, refetch } = useCustomer();
  const capture = useCapture();
  const [selection, setSelection] = useState<AmountSelection>({
    mode: "preset",
    amount: TOPUP_PRESETS[1],
  });
  const [customText, setCustomText] = useState("");
  const [busy, setBusy] = useState(false);
  // Set when checkout completes without a redirect URL (card on file): we then
  // confirm the charge before attaching so we never bill silently.
  const [confirmAmount, setConfirmAmount] = useState<number | null>(null);

  const amount =
    selection.mode === "custom"
      ? clampTopupAmount(Number(customText))
      : selection.amount;
  const customValid =
    selection.mode === "preset" ||
    (customText.trim() !== "" &&
      Number.isFinite(Number(customText)) &&
      Number(customText) >= MIN_TOPUP_USD);

  const topupOptions = [
    { featureId: EXTRA_USAGE_FEATURE_ID, quantity: amount },
  ];

  const finishAttach = async (value: number) => {
    setBusy(true);
    try {
      await attach({
        productId: EXTRA_USAGE_PRODUCT_ID,
        options: [{ featureId: EXTRA_USAGE_FEATURE_ID, quantity: value }],
      });
    } catch {
      // The charge itself failed — safe to let the user retry.
      showToast({
        message: "Couldn't add extra usage. Try again.",
        tone: "danger",
      });
      setBusy(false);
      return;
    }

    // The card was charged. From here nothing may re-trigger attach, so clear
    // the confirm prompt first; the balance refetch below is a best-effort UI
    // refresh and must never be treated as a purchase failure.
    capture(ANALYTICS_EVENTS.extraUsageTopupCompleted, { amount: value });
    showToast({ message: `Added ${formatUsd(value)} to your balance.` });
    setConfirmAmount(null);
    onPurchased?.();
    try {
      await refetch();
    } catch {
      // Balance will catch up on the next load.
    }
    setBusy(false);
  };

  const handleBuy = async () => {
    if (busy || !customValid) return;
    setBusy(true);
    capture(ANALYTICS_EVENTS.extraUsageTopupStarted, {
      amount,
      mode: selection.mode,
    });
    try {
      const result = await checkout({
        productId: EXTRA_USAGE_PRODUCT_ID,
        options: topupOptions,
      });
      const url = (result as { data?: { url?: string | null } })?.data?.url;
      if (url) {
        window.location.href = url;
        return;
      }
      // No hosted-checkout URL means Autumn can charge the saved card directly;
      // confirm the amount before we attach.
      setConfirmAmount(amount);
    } catch {
      showToast({
        message: "Couldn't start the top-up. Try again.",
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-black/[0.06] bg-black/[0.015] p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
      <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
        Load up extra usage
      </span>
      <p className="mt-0.5 text-[12px] text-neutral-500 dark:text-neutral-400">
        Spent only after your plan's usage runs out. $1 = $1 of usage, never
        expires.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {TOPUP_PRESETS.map((preset) => {
          const active =
            selection.mode === "preset" && selection.amount === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => setSelection({ mode: "preset", amount: preset })}
              className={`inline-flex h-9 min-w-[56px] items-center justify-center rounded-lg px-3 text-[13px] font-medium tabular-nums transition ${
                active
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "border border-black/[0.08] text-neutral-700 hover:bg-black/[0.03] dark:border-white/[0.1] dark:text-neutral-200 dark:hover:bg-white/[0.04]"
              }`}
            >
              ${preset}
            </button>
          );
        })}

        <div
          className={`flex h-9 items-center rounded-lg border px-2.5 transition ${
            selection.mode === "custom"
              ? "border-black/20 dark:border-white/30"
              : "border-black/[0.08] dark:border-white/[0.1]"
          }`}
        >
          <span className="text-[13px] text-neutral-500 dark:text-neutral-400">
            $
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={MIN_TOPUP_USD}
            max={MAX_TOPUP_USD}
            placeholder="Custom"
            value={customText}
            onFocus={() =>
              setSelection((s) =>
                s.mode === "custom" ? s : { mode: "custom", amount },
              )
            }
            onChange={(e) => {
              setCustomText(e.target.value);
              setSelection({
                mode: "custom",
                amount: clampTopupAmount(Number(e.target.value)),
              });
            }}
            className="h-full w-[72px] bg-transparent px-1 text-[13px] font-medium tabular-nums text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
        </div>
      </div>

      {selection.mode === "custom" && !customValid ? (
        <p className="mt-2 text-[12px] text-amber-600 dark:text-amber-400">
          Enter at least ${MIN_TOPUP_USD}.
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy || !customValid}
        onClick={() => void handleBuy()}
        className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-[13px] font-medium text-white outline-none transition hover:bg-blue-500 disabled:opacity-60"
      >
        {busy ? (
          <Spinner size={16} className="text-white" />
        ) : (
          <>
            <IconPlus size={15} stroke={2.25} />
            Add {formatUsd(amount)} to balance
          </>
        )}
      </button>

      <ConfirmCharge
        amount={confirmAmount}
        busy={busy}
        onCancel={() => setConfirmAmount(null)}
        onConfirm={(value) => void finishAttach(value)}
      />
    </div>
  );
}

function ConfirmCharge({
  amount,
  busy,
  onCancel,
  onConfirm,
}: {
  amount: number | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (amount: number) => void;
}) {
  return (
    <AnimatePresence>
      {amount != null && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.16 }}
          className="overflow-hidden"
        >
          <div className="mt-3 rounded-lg border border-black/[0.08] bg-white p-3 dark:border-white/[0.1] dark:bg-[#222]">
            <p className="text-[12.5px] text-neutral-700 dark:text-neutral-200">
              Charge {formatUsd(amount)} to your card on file and add it to your
              usage balance?
            </p>
            <div className="mt-2.5 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="h-9 rounded-lg px-3 text-[13px] text-neutral-600 hover:bg-black/[0.04] disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onConfirm(amount)}
                className="inline-flex h-9 min-w-[110px] items-center justify-center rounded-lg bg-blue-600 px-3 text-[13px] font-medium text-white outline-none transition hover:bg-blue-500 disabled:opacity-60"
              >
                {busy ? (
                  <Spinner size={14} className="text-white" />
                ) : (
                  `Confirm ${formatUsd(amount)}`
                )}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
