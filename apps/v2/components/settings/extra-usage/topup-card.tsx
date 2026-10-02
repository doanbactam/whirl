"use client";

import { useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useCustomer } from "autumn-js/react";

import { Button } from "@/components/ui/button";
import {
  clampTopupAmount,
  EXTRA_USAGE_FEATURE_ID,
  EXTRA_USAGE_PRODUCT_ID,
  MAX_TOPUP_USD,
  MIN_TOPUP_USD,
  TOPUP_PRESETS,
} from "@/lib/extra-usage";
import { formatUsd } from "@/lib/money";
import { showToast } from "@/lib/toasts";
import { ConfirmDialog } from "../../confirm-dialog";
import { SettingsCard } from "../settings-rows";

type AmountSelection = { mode: "preset" | "custom"; amount: number };

const WELL_SHADOW =
  "shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]";

/**
 * Lets a paid customer top up their separate extra-usage bucket by buying the
 * one-off `extra_usage` product ($1 per credit) — spent only after their
 * plan's included usage runs out. Ported from v1: try `checkout` (redirect to
 * Stripe when a URL comes back), otherwise confirm and `attach` against the
 * card on file — never a silent charge.
 */
export function TopUpCard() {
  const { checkout, attach, refetch } = useCustomer();
  const [selection, setSelection] = useState<AmountSelection>({
    mode: "preset",
    amount: TOPUP_PRESETS[1],
  });
  const [customText, setCustomText] = useState("");
  const [busy, setBusy] = useState(false);
  // Set when checkout completes without a redirect URL (card on file): we
  // confirm the charge before attaching.
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

  const finishAttach = async (value: number) => {
    setBusy(true);
    try {
      await attach({
        productId: EXTRA_USAGE_PRODUCT_ID,
        options: [{ featureId: EXTRA_USAGE_FEATURE_ID, quantity: value }],
      });
    } catch {
      // The charge itself failed — safe to let the user retry.
      showToast("Couldn't add extra usage. Try again.");
      setBusy(false);
      return;
    }

    // The card was charged; the balance refetch below is a best-effort UI
    // refresh and must never read as a purchase failure.
    showToast(`Added ${formatUsd(value)} to your balance.`);
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
    try {
      const result = await checkout({
        productId: EXTRA_USAGE_PRODUCT_ID,
        options: [{ featureId: EXTRA_USAGE_FEATURE_ID, quantity: amount }],
      });
      const url = (result as { data?: { url?: string | null } })?.data?.url;
      if (url) {
        window.location.href = url;
        return;
      }
      // No hosted-checkout URL means Autumn can charge the saved card
      // directly; confirm the amount before we attach.
      setConfirmAmount(amount);
    } catch {
      showToast("Couldn't start the top-up. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard>
      <div className="p-4">
        <span className="text-sm font-medium">Load up extra usage</span>
        <p className="mt-0.5 text-[13px]/[18px] text-muted-foreground">
          Spent only after your plan&apos;s usage runs out. $1 = $1 of usage,
          never expires.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {TOPUP_PRESETS.map((preset) => {
            const active =
              selection.mode === "preset" && selection.amount === preset;
            return (
              <button
                key={preset}
                type="button"
                onClick={() =>
                  setSelection({ mode: "preset", amount: preset })
                }
                className={`h-9 min-w-14 cursor-pointer rounded-full px-3 text-[13.5px]/4 font-medium tabular-nums transition-[background-color,color] duration-150 ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : `bg-well text-muted-foreground ${WELL_SHADOW} hover:bg-[color-mix(in_oklch,var(--well),var(--foreground)_5%)] hover:text-foreground`
                }`}
              >
                ${preset}
              </button>
            );
          })}

          <label
            className={`flex h-9 items-center rounded-full bg-well px-3 transition-shadow duration-150 ${
              selection.mode === "custom"
                ? "shadow-[inset_0_0_0_1.5px_var(--foreground)]"
                : WELL_SHADOW
            }`}
          >
            <span className="text-[13px] text-muted-foreground">$</span>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_TOPUP_USD}
              max={MAX_TOPUP_USD}
              placeholder="Custom"
              value={customText}
              onFocus={() =>
                setSelection((prev) =>
                  prev.mode === "custom" ? prev : { mode: "custom", amount },
                )
              }
              onChange={(event) => {
                setCustomText(event.target.value);
                setSelection({
                  mode: "custom",
                  amount: clampTopupAmount(Number(event.target.value)),
                });
              }}
              className="h-full w-18 bg-transparent px-1 text-[13px] font-medium tabular-nums outline-none placeholder:font-normal placeholder:text-muted-foreground"
            />
          </label>
        </div>

        {selection.mode === "custom" && !customValid && (
          <p className="mt-2 text-[12px] text-destructive">
            Enter at least ${MIN_TOPUP_USD}.
          </p>
        )}

        <Button
          size="lg"
          className="mt-4 w-full"
          disabled={busy || !customValid}
          onClick={() => void handleBuy()}
        >
          <IconPlus size={15} />
          {busy ? "Working on it…" : `Add ${formatUsd(amount)} to balance`}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmAmount != null}
        onOpenChange={(open) => {
          if (!open) setConfirmAmount(null);
        }}
        title="Confirm the top-up?"
        message={`We'll charge ${formatUsd(confirmAmount ?? 0)} to your card on file and add it to your usage balance.`}
        confirmLabel={`Charge ${formatUsd(confirmAmount ?? 0)}`}
        onConfirm={() => {
          const value = confirmAmount;
          setConfirmAmount(null);
          if (value != null) void finishAttach(value);
        }}
      />
    </SettingsCard>
  );
}
