import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { IconSparkles } from "@tabler/icons-react";

import { Spinner } from "~/components/spinner";
import { Switch } from "~/components/switch";
import { api } from "~/lib/backend";
import { userErrorMessage } from "~/lib/errors";
import {
  fromLocalInput,
  multiplierLabel,
  toLocalInput,
  type MultiplierConfig,
} from "./admin-types";

const fieldClass =
  "h-9 w-full rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] text-neutral-900 outline-none transition focus:border-blue-500/40 focus:ring-2 focus:ring-blue-500/15 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100";

export function MultiplierSection() {
  const config = useQuery(api.admin.getMultiplierConfig) as
    | MultiplierConfig
    | undefined;
  const setMultiplierConfig = useMutation(api.admin.setMultiplierConfig);

  const [enabled, setEnabled] = useState(false);
  const [multiplier, setMultiplier] = useState("0.5");
  const [headline, setHeadline] = useState("");
  const [subtext, setSubtext] = useState("");
  const [applyToFree, setApplyToFree] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (seeded || config === undefined) return;
    if (config) {
      setEnabled(config.enabled ?? false);
      setMultiplier(String(config.multiplier ?? 0.5));
      setHeadline(config.headline ?? "");
      setSubtext(config.subtext ?? "");
      setApplyToFree(config.applyToFreeMessages ?? false);
      setStartsAt(toLocalInput(config.startsAt));
      setExpiresAt(toLocalInput(config.expiresAt));
    }
    setSeeded(true);
  }, [config, seeded]);

  const multiplierNumber = Number(multiplier);
  const previewLabel = Number.isFinite(multiplierNumber)
    ? multiplierLabel(multiplierNumber)
    : "—";

  const save = async () => {
    setNotice(null);
    setError(null);
    if (!Number.isFinite(multiplierNumber) || multiplierNumber <= 0) {
      setError("Multiplier must be a positive number.");
      return;
    }
    const start = fromLocalInput(startsAt);
    const end = fromLocalInput(expiresAt);
    if (start !== undefined && end !== undefined && start >= end) {
      setError("The event must end after it starts.");
      return;
    }

    setSaving(true);
    try {
      await setMultiplierConfig({
        multiplier: multiplierNumber,
        headline: headline.trim(),
        subtext: subtext.trim() || undefined,
        applyToFreeMessages: applyToFree,
        startsAt: start,
        expiresAt: end,
        enabled,
      });
      setNotice("Usage event saved.");
    } catch (cause) {
      setError(userErrorMessage(cause, "Couldn't save the usage event."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-black/[0.07] bg-white/55 p-5 dark:border-white/[0.07] dark:bg-white/[0.025]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-blue-600 dark:text-blue-400">
            <IconSparkles size={17} stroke={2} />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              Usage-multiplier event
            </h2>
            <p className="mt-0.5 text-[12.5px] text-neutral-500 dark:text-neutral-400">
              Temporarily make every allowance go further and announce it in
              Whirl.
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          onChange={setEnabled}
          disabled={!seeded}
          label="Enable usage-multiplier event"
        />
      </div>

      {config === undefined ? (
        <div className="flex min-h-44 items-center justify-center text-neutral-400">
          <Spinner size={17} />
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div className="space-y-4">
              <Field label={`Deduction multiplier (${previewLabel} usage)`}>
                <input
                  type="number"
                  step="0.05"
                  min="0.05"
                  value={multiplier}
                  onChange={(event) => setMultiplier(event.target.value)}
                  className={fieldClass}
                />
                <p className="mt-1 text-[11px] text-neutral-400">
                  0.5 means half cost, so customers receive 2× usage.
                </p>
              </Field>

              <label className="flex items-center justify-between gap-3 rounded-xl border border-black/[0.07] px-3 py-2.5 dark:border-white/[0.08]">
                <span className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">
                  Also scale free-plan messages
                </span>
                <Switch
                  checked={applyToFree}
                  onChange={setApplyToFree}
                  label="Also scale free-plan messages"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Starts">
                  <input
                    type="datetime-local"
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                    className={fieldClass}
                  />
                </Field>
                <Field label="Ends">
                  <input
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(event) => setExpiresAt(event.target.value)}
                    className={fieldClass}
                  />
                </Field>
              </div>
            </div>

            <div className="space-y-4">
              <Field label="Banner headline">
                <input
                  type="text"
                  value={headline}
                  onChange={(event) => setHeadline(event.target.value)}
                  placeholder="2× usage is live"
                  className={fieldClass}
                />
              </Field>
              <Field label="Banner subtext">
                <input
                  type="text"
                  value={subtext}
                  onChange={(event) => setSubtext(event.target.value)}
                  placeholder="Every prompt goes twice as far this week."
                  className={fieldClass}
                />
              </Field>

              <div>
                <p className="mb-1.5 text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
                  Banner preview
                </p>
                <div className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0c82f2] to-[#0a6fd0] px-4 py-2 text-white">
                  <IconSparkles size={15} stroke={2} className="shrink-0" />
                  <p className="truncate text-[13px]">
                    <span className="font-semibold">
                      {headline || "Your headline here"}
                    </span>
                    {subtext && (
                      <span className="ml-2 opacity-90">{subtext}</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-3">
            {error && (
              <p className="mr-auto text-[12.5px] text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            {notice && (
              <p className="mr-auto text-[12.5px] text-emerald-700 dark:text-emerald-300">
                {notice}
              </p>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-[13px] font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
            >
              {saving && <Spinner size={13} />}
              {saving ? "Saving…" : "Save event"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      {children}
    </label>
  );
}
