import { useRef, useState } from "react";
import { useAction } from "convex/react";
import { IconFileUpload, IconUpload } from "@tabler/icons-react";

import { Modal } from "~/components/modal";
import { Spinner } from "~/components/spinner";
import { CONSOLE_EVENTS, useCapture } from "~/lib/analytics";
import { api } from "~/lib/backend";
import { userErrorMessage } from "~/lib/errors";
import { parseModelImport, type ModelImportRow } from "./model-import";

export function ModelImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const bulkCreate = useAction(api.models.bulkCreate);
  const capture = useCapture();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [models, setModels] = useState<ModelImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resetAndClose = () => {
    if (busy) return;
    setFileName("");
    setModels([]);
    setError(null);
    onClose();
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const next = parseModelImport(await file.text());
      setFileName(file.name);
      setModels(next);
    } catch (cause) {
      setFileName("");
      setModels([]);
      setError(
        cause instanceof Error ? cause.message : "Couldn't read that JSON file.",
      );
    }
  };

  const submit = async () => {
    if (models.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await bulkCreate({ models });
      capture(CONSOLE_EVENTS.modelsImported, { count: result.added });
      onImported(result.added);
      setFileName("");
      setModels([]);
      onClose();
    } catch (cause) {
      setError(userErrorMessage(cause, "Couldn't import those models."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={resetAndClose} widthClass="max-w-lg">
      <div className="p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/[0.1] text-blue-600 dark:text-blue-400">
            <IconFileUpload size={18} stroke={2} />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              Import models
            </h2>
            <p className="text-[12.5px] text-neutral-500 dark:text-neutral-400">
              Up to 50 OpenRouter models in one JSON file.
            </p>
          </div>
        </div>

        <pre className="mt-4 overflow-x-auto rounded-xl bg-black/[0.04] p-3 font-mono text-[11px] leading-relaxed text-neutral-600 dark:bg-white/[0.05] dark:text-neutral-300">
{`[
  "anthropic/claude-sonnet-4.5",
  {
    "slug": "openai/gpt-5.4",
    "displayName": "GPT 5.4"
  }
]`}
        </pre>
        <p className="mt-2 text-[11.5px] leading-relaxed text-neutral-400 dark:text-neutral-500">
          You can also supply company, provider, or modelName overrides.
          Capabilities and missing names are detected from OpenRouter.
        </p>

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-black/[0.14] px-4 py-5 text-[13px] font-medium text-neutral-600 transition hover:border-blue-500 hover:text-blue-600 disabled:opacity-60 dark:border-white/[0.14] dark:text-neutral-300 dark:hover:border-blue-400 dark:hover:text-blue-400"
        >
          <IconUpload size={16} stroke={2} />
          {fileName || "Choose JSON file"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,.jsonc,application/json"
          className="hidden"
          onChange={(event) => {
            void pick(event.target.files?.[0]);
            event.target.value = "";
          }}
        />

        {models.length > 0 && (
          <div className="mt-3 rounded-lg bg-emerald-500/[0.08] px-3 py-2 text-[12.5px] text-emerald-700 dark:bg-emerald-500/[0.12] dark:text-emerald-300">
            Ready to validate and add {models.length} model
            {models.length === 1 ? "" : "s"}.
          </div>
        )}
        {error && (
          <p className="mt-3 rounded-lg bg-red-500/[0.08] px-3 py-2 text-[12.5px] text-red-700 dark:bg-red-500/[0.12] dark:text-red-300">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={resetAndClose}
            className="inline-flex h-9 items-center rounded-lg border border-black/[0.08] bg-white px-3.5 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 disabled:opacity-50 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || models.length === 0}
            onClick={() => void submit()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-[13px] font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            {busy && <Spinner size={13} />}
            {busy
              ? "Checking models…"
              : `Import${models.length ? ` ${models.length}` : ""}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
