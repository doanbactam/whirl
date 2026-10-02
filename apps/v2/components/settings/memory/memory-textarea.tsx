"use client";

import { useEffect, useRef } from "react";

import { MAX_MEMORY_CONTENT } from "@/lib/user-memory";

/* The one text field memories are written in — shared by the add form and
   the inline row editor so both grow, cap, and take keys the same way.
   Enter commits, Shift+Enter breaks the line, Escape backs out. */
export function MemoryTextarea({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  /* Focus with the caret at the end — an edit should be ready to type into,
     not ready to overwrite. A frame late so it lands after a dialog popup
     has claimed focus, matching components/rename-dialog.tsx. */
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  /* Grow to fit whatever's in it, including the seeded value. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="flex flex-col gap-1">
      <textarea
        ref={ref}
        value={value}
        rows={2}
        disabled={disabled}
        maxLength={MAX_MEMORY_CONTENT}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        className="max-h-56 w-full resize-none overflow-y-auto rounded-lg bg-well px-3 py-2.5 text-[13px]/5 shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)] outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      />
      {value.length >= MAX_MEMORY_CONTENT - 100 && (
        <p className="text-right text-[11px]/4 tabular-nums text-muted-foreground">
          {value.length} / {MAX_MEMORY_CONTENT}
        </p>
      )}
    </div>
  );
}
