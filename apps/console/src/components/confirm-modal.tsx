import { useState } from "react";

import { Modal } from "~/components/modal";
import { Spinner } from "~/components/spinner";

/**
 * A yes/no confirmation with an async confirm action. The destructive variant
 * paints the confirm button red; errors from `onConfirm` surface inline.
 */
export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  destructive = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={close}>
      <div className="p-5">
        <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {title}
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          {body}
        </p>
        {error && (
          <p className="mt-3 rounded-lg bg-red-500/[0.08] px-3 py-2 text-[12.5px] text-red-700 dark:bg-red-500/[0.12] dark:text-red-300">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-lg border border-black/[0.08] bg-white px-3.5 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 disabled:opacity-50 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Something went wrong.");
              } finally {
                setBusy(false);
              }
            }}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-medium text-white transition disabled:opacity-60 ${
              destructive
                ? "bg-red-600 hover:bg-red-500"
                : "bg-blue-600 hover:bg-blue-500"
            }`}
          >
            {busy && <Spinner size={13} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
