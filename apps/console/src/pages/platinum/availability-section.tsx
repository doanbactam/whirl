import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { IconDiamondFilled } from "@tabler/icons-react";

import { Spinner } from "~/components/spinner";
import { Switch } from "~/components/switch";
import { api } from "~/lib/backend";
import { userErrorMessage } from "~/lib/errors";

/**
 * The one switch that decides whether /platinum sells or takes names. Closed
 * is the default and the resting state — the page still shows both tiers,
 * it just swaps its buttons for "Request an invite".
 */
export function AvailabilitySection() {
  const availability = useQuery(api.platinum.availability);
  const setAvailability = useMutation(api.platinum.setAvailability);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = availability?.open ?? false;

  const toggle = async (next: boolean) => {
    setError(null);
    setSaving(true);
    try {
      await setAvailability({ open: next });
    } catch (cause) {
      setError(userErrorMessage(cause, "Couldn't change availability."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-black/[0.07] bg-white/55 p-5 dark:border-white/[0.07] dark:bg-white/[0.025]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-neutral-400 dark:text-neutral-500">
            <IconDiamondFilled size={17} />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              Open for purchase
            </h2>
            <p className="mt-0.5 text-[12.5px] text-neutral-500 dark:text-neutral-400">
              {availability === undefined
                ? "Checking…"
                : open
                  ? "Anyone can buy both tiers from /platinum."
                  : "/platinum is collecting requests instead of selling."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Spinner size={13} className="text-neutral-400" />}
          <Switch
            checked={open}
            onChange={(next) => void toggle(next)}
            disabled={availability === undefined || saving}
            label="Open Platinum for purchase"
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 text-[12.5px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
