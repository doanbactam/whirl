import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Editor } from "@tiptap/react";
import type { TablerIcon } from "@tabler/icons-react";
import {
  IconChevronDown,
  IconDownload,
  IconFile,
  IconFileText,
  IconFileTypePdf,
} from "@tabler/icons-react";

import { DropdownShell, dropdownItemClass } from "~/components/dropdown-menu";
import {
  downloadDocx,
  downloadMarkdown,
  downloadPdf,
} from "~/lib/document-export";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

type ExportFormat = "markdown" | "docx" | "pdf";

const FORMATS: {
  format: ExportFormat;
  label: string;
  hint: string;
  icon: TablerIcon;
}[] = [
  { format: "markdown", label: "Markdown", hint: ".md", icon: IconFile },
  { format: "docx", label: "Word", hint: ".docx", icon: IconFileText },
  { format: "pdf", label: "PDF", hint: ".pdf", icon: IconFileTypePdf },
];

/**
 * The document panel's download control: a button that drops a small menu to
 * export the current editor contents as Markdown, Word, or PDF.
 */
export function DocumentDownloadMenu({
  editor,
  name,
}: {
  editor: Editor | null;
  name: string;
}) {
  const capture = useCapture();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleExport = async (format: ExportFormat) => {
    setOpen(false);
    if (!editor) return;
    const markdown = (
      editor.storage as unknown as { markdown: { getMarkdown: () => string } }
    ).markdown.getMarkdown();
    const html = editor.getHTML();
    capture(ANALYTICS_EVENTS.documentDownloaded, { format });
    try {
      if (format === "markdown") downloadMarkdown(name, markdown);
      else if (format === "docx") await downloadDocx(name, html);
      else downloadPdf(name, html);
    } catch {
      // Swallow — a failed export shouldn't break the editor.
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Download document"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Download"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-7 shrink-0 items-center gap-1 rounded-md bg-[#0c82f2] pl-2 pr-1.5 text-white transition-colors hover:bg-[#0a74d8] ${
          open ? "bg-[#0a74d8]" : ""
        }`}
      >
        <IconDownload size={14} stroke={2} />
        <span className="text-[12px] font-medium">Download</span>
        <IconChevronDown
          size={13}
          stroke={2.5}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.14, ease: [0.22, 0.61, 0.36, 1] }}
            className="absolute right-0 top-9 z-30 w-44 origin-top-right"
          >
            <DropdownShell>
              {FORMATS.map(({ format, label, hint, icon }) => {
                const Glyph = icon;
                return (
                  <button
                    key={format}
                    type="button"
                    role="menuitem"
                    onClick={() => void handleExport(format)}
                    className={dropdownItemClass}
                  >
                    <Glyph
                      size={16}
                      stroke={2}
                      className="shrink-0 text-neutral-500 dark:text-neutral-400"
                    />
                    <span className="flex-1">{label}</span>
                    <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                      {hint}
                    </span>
                  </button>
                );
              })}
            </DropdownShell>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
