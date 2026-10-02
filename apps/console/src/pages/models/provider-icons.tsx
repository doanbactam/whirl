import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { IconPencil, IconSparkles } from "@tabler/icons-react";

import { Modal } from "~/components/modal";
import { MonoIcon } from "~/components/mono-icon";
import { Skeleton } from "~/components/skeleton";
import { Spinner } from "~/components/spinner";
import { CONSOLE_EVENTS, useCapture } from "~/lib/analytics";
import { api, type ModelProvider } from "~/lib/backend";
import { userErrorMessage } from "~/lib/errors";
import { SvgIconField } from "~/pages/integrations/branding-fields";

export function ProviderIcons({
  providers,
}: {
  providers: ModelProvider[] | undefined;
}) {
  const [editing, setEditing] = useState<ModelProvider | null>(null);
  return (
    <>
      {providers === undefined ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[58px] rounded-xl" />
          ))}
        </div>
      ) : providers.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] bg-white px-4 py-5 text-[12.5px] text-neutral-500 dark:border-white/[0.06] dark:bg-[#1B1B1B] dark:text-neutral-400">
          Providers appear here as soon as a model is added.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {providers.map((provider) => (
            <button
              key={provider.name.toLocaleLowerCase()}
              type="button"
              onClick={() => setEditing(provider)}
              className="flex min-h-[58px] items-center gap-3 rounded-xl border border-black/[0.06] bg-white px-3.5 text-left transition hover:border-black/[0.12] hover:bg-neutral-50 dark:border-white/[0.06] dark:bg-[#1B1B1B] dark:hover:border-white/[0.12] dark:hover:bg-[#202020]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-neutral-400 dark:bg-white/[0.06] dark:text-neutral-500">
                {provider.iconSvg ? (
                  <MonoIcon svg={provider.iconSvg} size={16} />
                ) : (
                  <IconSparkles size={15} stroke={1.8} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                  {provider.name}
                </span>
                <span className="block text-[11.5px] text-neutral-400 dark:text-neutral-500">
                  {provider.modelCount} model
                  {provider.modelCount === 1 ? "" : "s"}
                </span>
              </span>
              <IconPencil
                size={14}
                stroke={2}
                className="shrink-0 text-neutral-400"
              />
            </button>
          ))}
        </div>
      )}
      <ProviderIconModal
        provider={editing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function ProviderIconModal({
  provider,
  onClose,
}: {
  provider: ModelProvider | null;
  onClose: () => void;
}) {
  const setProviderIcon = useMutation(api.models.setProviderIcon);
  const capture = useCapture();
  const [iconSvg, setIconSvg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIconSvg(provider?.iconSvg ?? null);
    setError(null);
  }, [provider]);

  const save = async () => {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      await setProviderIcon({ name: provider.name, iconSvg });
      capture(CONSOLE_EVENTS.modelProviderIconChanged, {
        provider: provider.name,
        hasIcon: iconSvg !== null,
      });
      onClose();
    } catch (cause) {
      setError(userErrorMessage(cause, "Couldn't save that provider icon."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={provider !== null} onClose={busy ? () => {} : onClose}>
      <div className="p-5">
        <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {provider?.name ?? "Provider"} icon
        </h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          This icon is shared by every model from this provider.
        </p>
        <div className="mt-4">
          <SvgIconField
            value={iconSvg}
            onChange={setIconSvg}
            hint="A monochrome SVG, recolored to match the app. Changing it updates every matching model."
          />
        </div>
        {error && (
          <p className="mt-3 rounded-lg bg-red-500/[0.08] px-3 py-2 text-[12.5px] text-red-700 dark:bg-red-500/[0.12] dark:text-red-300">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg border border-black/[0.08] bg-white px-3.5 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 disabled:opacity-50 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-[13px] font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            {busy && <Spinner size={13} />}
            Save icon
          </button>
        </div>
      </div>
    </Modal>
  );
}
