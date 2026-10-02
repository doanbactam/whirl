import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { IconPhoto, IconUpload, IconX } from "@tabler/icons-react";

import { MonoIcon } from "~/components/mono-icon";
import { Spinner } from "~/components/spinner";
import { api, type Id } from "~/lib/backend";

/** Uploads a file to Convex storage and returns its storage id. */
export function useStorageUpload() {
  const generateUploadUrl = useMutation(api.integrations.generateUploadUrl);
  return async (file: File): Promise<Id<"_storage">> => {
    const postUrl = await generateUploadUrl();
    const res = await fetch(postUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!res.ok) throw new Error("Upload failed — try again.");
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    return storageId;
  };
}

export type UploadedImage = {
  /** Absent when the image is the one already saved on the row (edit mode) —
   * submit sends the id only for replacements. */
  storageId?: Id<"_storage">;
  previewUrl: string;
};

/**
 * An image picker that uploads straight to Convex storage on selection.
 * `shape` controls the preview: "square" for logos, "banner" for the wide one.
 */
export function ImageUploadField({
  label,
  hint,
  optional = false,
  shape,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  optional?: boolean;
  shape: "square" | "banner";
  value: UploadedImage | null;
  onChange: (next: UploadedImage | null) => void;
}) {
  const upload = useStorageUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const storageId = await upload(file);
      onChange({ storageId, previewUrl: URL.createObjectURL(file) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const previewClass =
    shape === "square"
      ? "h-16 w-16 rounded-xl"
      : "h-20 w-full max-w-sm rounded-xl";

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel label={label} optional={optional} />
      <div className="flex items-center gap-3">
        {value ? (
          <div className="group relative">
            <img
              src={value.previewUrl}
              alt=""
              className={`${previewClass} border border-black/[0.08] object-cover dark:border-white/[0.1]`}
            />
            <button
              type="button"
              aria-label={`Remove ${label.toLowerCase()}`}
              onClick={() => onChange(null)}
              className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 dark:bg-neutral-200 dark:text-neutral-900"
            >
              <IconX size={11} stroke={2.5} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className={`${previewClass} flex items-center justify-center border border-dashed border-black/[0.15] text-neutral-400 transition hover:border-[#0c82f2] hover:text-[#0c82f2] disabled:opacity-50 dark:border-white/[0.15] dark:text-neutral-500`}
          >
            {busy ? (
              <Spinner size={15} />
            ) : shape === "square" ? (
              <IconPhoto size={18} stroke={1.8} />
            ) : (
              <span className="flex items-center gap-2 text-[12px]">
                <IconUpload size={14} stroke={2} />
                Upload banner
              </span>
            )}
          </button>
        )}
        <p className="max-w-[16rem] text-[11.5px] leading-snug text-neutral-400 dark:text-neutral-500">
          {hint}
        </p>
      </div>
      {error && (
        <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/**
 * Optional monochrome SVG icon. Read as text (not uploaded) so the client
 * can recolor it via CSS mask; the gray preview shows exactly how it renders
 * when Whirl uses the integration. The default copy speaks integration —
 * pass `hint` when the icon belongs to something else (e.g. a model).
 */
export function SvgIconField({
  value,
  onChange,
  hint = "A small SVG shown gray wherever Whirl uses this integration, instead of the generic plug icon. Previewed exactly as it'll appear.",
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const text = await file.text();
    if (!text.toLowerCase().includes("<svg")) {
      setError("That file doesn't look like an SVG.");
      return;
    }
    if (text.length > 32_000) {
      setError("Keep the icon under 32 KB.");
      return;
    }
    onChange(text);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel label="Icon" optional />
      <div className="flex items-center gap-3">
        {value ? (
          <div className="group relative flex h-16 w-16 items-center justify-center rounded-xl border border-black/[0.08] dark:border-white/[0.1]">
            <MonoIcon svg={value} size={20} />
            <button
              type="button"
              aria-label="Remove icon"
              onClick={() => onChange(null)}
              className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 dark:bg-neutral-200 dark:text-neutral-900"
            >
              <IconX size={11} stroke={2.5} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-black/[0.15] text-neutral-400 transition hover:border-[#0c82f2] hover:text-[#0c82f2] dark:border-white/[0.15] dark:text-neutral-500"
          >
            <IconUpload size={16} stroke={1.8} />
          </button>
        )}
        <p className="max-w-[16rem] text-[11.5px] leading-snug text-neutral-400 dark:text-neutral-500">
          {hint}
        </p>
      </div>
      {error && (
        <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function FieldLabel({
  label,
  optional = false,
}: {
  label: string;
  optional?: boolean;
}) {
  return (
    <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
      {label}
      {optional && (
        <span className="font-normal text-neutral-400 dark:text-neutral-500">
          {" "}
          (optional)
        </span>
      )}
    </span>
  );
}
