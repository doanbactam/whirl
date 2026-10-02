import { useState, type ReactNode } from "react";
import type { TablerIcon } from "@tabler/icons-react";
import {
  IconAlertCircle,
  IconFile,
  IconFileCode,
  IconFileMusic,
  IconFileSpreadsheet,
  IconFileTypePdf,
  IconFileTypePpt,
  IconFileTypeDocx,
  IconFileTypeXls,
  IconFileZip,
  IconMovie,
  IconX,
} from "@tabler/icons-react";

import { ImageShimmer } from "~/components/generated-image";
import { Squircle, SquircleUnderlay } from "~/components/squircle";
import { formatSize } from "~/lib/attachment-upload";

/** Icon + label + colour tint for a file, picked from its name and MIME type. */
export function fileMeta(
  name: string,
  type: string,
): { icon: TablerIcon; label: string; tint: string } {
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() ?? "" : "";
  const t = type.toLowerCase();
  if (t === "application/pdf" || ext === "pdf") {
    return {
      icon: IconFileTypePdf,
      label: "PDF",
      tint: "bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-400",
    };
  }
  if (["doc", "docx", "docm", "dotx", "odt", "rtf"].includes(ext)) {
    return {
      icon: IconFileTypeDocx,
      label: ext === "rtf" ? "RTF" : "Document",
      tint: "bg-blue-500/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
    };
  }
  if (
    ["xls", "xlsx", "xlsm", "xltx", "ods"].includes(ext) ||
    t.includes("spreadsheet") ||
    t.includes("ms-excel")
  ) {
    return {
      icon:
        ext === "xlsx" || ext === "xlsm" || ext === "xls"
          ? IconFileTypeXls
          : IconFileSpreadsheet,
      label: "Spreadsheet",
      tint: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
    };
  }
  if (
    ["ppt", "pptx", "pptm", "ppsx", "odp"].includes(ext) ||
    t.includes("presentation") ||
    t.includes("ms-powerpoint")
  ) {
    return {
      icon: IconFileTypePpt,
      label: "Presentation",
      tint: "bg-orange-500/10 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400",
    };
  }
  if (t.startsWith("video/")) {
    return {
      icon: IconMovie,
      label: "Video",
      tint: "bg-purple-500/10 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400",
    };
  }
  if (t.startsWith("audio/")) {
    return {
      icon: IconFileMusic,
      label: "Audio",
      tint: "bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
    };
  }
  if (
    ["zip", "rar", "7z", "tar", "gz", "bz2"].includes(ext) ||
    t.includes("zip") ||
    t.includes("compressed")
  ) {
    return {
      icon: IconFileZip,
      label: "Archive",
      tint: "bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-400",
    };
  }
  if (
    t.startsWith("text/") ||
    ["js", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "c", "cpp", "h", "css", "html", "json", "jsonc", "yaml", "yml", "md", "sh"].includes(ext)
  ) {
    return {
      icon: IconFileCode,
      label: ext ? ext.toUpperCase() : "Text",
      tint: "bg-sky-500/10 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
    };
  }
  return {
    icon: IconFile,
    label: ext ? ext.toUpperCase() : "File",
    tint: "bg-neutral-500/10 text-neutral-600 dark:bg-neutral-400/15 dark:text-neutral-300",
  };
}

/**
 * An image attachment thumbnail, locked to the same height as AttachmentCard
 * so mixed trays of pictures and file chips line up on one row. Shared by the
 * composer and sent messages. Pass `dimmed` to fade it while uploading.
 */
export function AttachmentImageThumb({
  src,
  alt,
  onClick,
  dimmed = false,
}: {
  src: string;
  alt: string;
  onClick?: () => void;
  dimmed?: boolean;
}) {
  // The picture stays invisible until its bytes have fully arrived — the
  // shimmer holds the spot, never the browser's own progressive paint.
  const [loaded, setLoaded] = useState(false);
  return (
    <Squircle
      as="button"
      radius={12}
      type="button"
      onClick={onClick}
      aria-label={`Open ${alt}`}
      className="relative block overflow-hidden rounded-2xl border border-black/[0.06] bg-black/[0.03] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-opacity hover:opacity-95 dark:border-white/[0.08] dark:bg-white/[0.05] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
    >
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={`block h-[52px] w-auto min-w-[52px] max-w-[180px] object-cover transition-opacity duration-300 ${
          loaded ? (dimmed ? "opacity-70" : "") : "opacity-0"
        }`}
      />
      {!loaded && <ImageShimmer label={`Loading ${alt}`} />}
    </Squircle>
  );
}

/**
 * The standard file chip — a 240px card with an icon tint, name and a small
 * subtitle. Shared by sent messages and the composer so attachments look the
 * same wherever they show up. Pass `onClick` to make it open something,
 * `onRemove` for a hover-revealed delete button, and `footer` for extras like
 * an upload progress bar.
 */
export function AttachmentCard({
  name,
  type,
  size,
  subtitle,
  onClick,
  onRemove,
  removeLabel,
  error = false,
  highlighted = false,
  badge,
  footer,
}: {
  name: string;
  type: string;
  size: number;
  subtitle?: ReactNode;
  onClick?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  error?: boolean;
  /** Paints an accent border to mark the chip as special (e.g. carrying edits). */
  highlighted?: boolean;
  /** A tiny pill shown next to the filename, e.g. "Edited". */
  badge?: string;
  footer?: ReactNode;
}) {
  const meta = fileMeta(name, type);
  const sub = subtitle ?? `${meta.label} · ${formatSize(size)}`;
  const Glyph = error ? IconAlertCircle : meta.icon;

  const row = (
    <>
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          error
            ? "bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-400"
            : meta.tint
        }`}
      >
        <Glyph size={18} stroke={2} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-neutral-800 dark:text-neutral-100">
            {name}
          </span>
          {badge ? (
            <span className="shrink-0 rounded-full bg-[#0c82f2]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#0c82f2] dark:bg-[#0c82f2]/15">
              {badge}
            </span>
          ) : null}
        </span>
        <span
          className={`truncate text-[11px] ${
            error
              ? "text-red-500 dark:text-red-400"
              : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          {sub}
        </span>
      </span>
    </>
  );

  return (
    <div className="group/att relative isolate flex w-[240px] flex-col">
      {/* Chrome lives on a clipped underlay — the hover-revealed remove
          button hangs outside the card, so the card itself can't be clipped. */}
      <SquircleUnderlay
        radius={12}
        className={`rounded-2xl border shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:shadow-[0_1px_2px_rgba(0,0,0,0.3)] ${
          error
            ? "border-red-500/30 bg-red-500/[0.04] dark:border-red-500/30 dark:bg-red-500/[0.06]"
            : highlighted
              ? "border-[#0c82f2]/40 bg-[#0c82f2]/[0.04] ring-1 ring-[#0c82f2]/20 dark:border-[#0c82f2]/40 dark:bg-[#0c82f2]/[0.07]"
              : "border-black/[0.06] bg-white/70 dark:border-white/[0.08] dark:bg-white/[0.04]"
        }`}
      />
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="flex w-full items-center gap-2.5 rounded-2xl p-2 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
        >
          {row}
        </button>
      ) : (
        <div className="flex w-full items-center gap-2.5 p-2">{row}</div>
      )}
      {footer ? <div className="px-2 pb-2">{footer}</div> : null}
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel ?? `Remove ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-black/[0.06] bg-white text-neutral-500 opacity-0 shadow-sm transition-opacity hover:text-neutral-800 group-hover/att:opacity-100 focus-visible:opacity-100 dark:border-white/[0.1] dark:bg-[#2a2a2a] dark:text-neutral-300 dark:hover:text-neutral-100"
        >
          <IconX size={11} stroke={2.5} />
        </button>
      ) : null}
    </div>
  );
}
