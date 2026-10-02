"use client";

import { useState } from "react";
import type { TablerIcon } from "@tabler/icons-react";
import { IconEye, IconEyeOff, IconLockFilled } from "@tabler/icons-react";

/* Flat v2 field shells: ring-border at rest, ring-ring when focused —
   same recipe as ui/input.tsx, plus a leading glyph. */
const SHELL =
  "flex h-10 items-center rounded-lg ring-1 ring-border transition-shadow focus-within:ring-2 focus-within:ring-ring";
const INPUT =
  "h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground";

export function IconField({
  icon,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
  autoFocus,
}: {
  icon: TablerIcon;
  type: "email" | "text";
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const Glyph = icon;
  return (
    <div className={SHELL}>
      <span className="flex h-full w-9 shrink-0 items-center justify-center text-muted-foreground">
        <Glyph size={15} />
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        autoFocus={autoFocus}
        className={`${INPUT} pr-3`}
      />
    </div>
  );
}

export function PasswordField({
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete?: string;
  required?: boolean;
}) {
  const [show, setShow] = useState(false);
  const Glyph = show ? IconEyeOff : IconEye;
  return (
    <div className={SHELL}>
      <span className="flex h-full w-9 shrink-0 items-center justify-center text-muted-foreground">
        <IconLockFilled size={15} />
      </span>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className={`${INPUT} pr-1`}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"}
        className="mr-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Glyph size={15} />
      </button>
    </div>
  );
}

export function CodeField({
  value,
  onChange,
  placeholder,
  autoFocus,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  required?: boolean;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      required={required}
      className="h-11 w-full rounded-lg text-center text-lg font-medium tracking-[0.4em] tabular-nums ring-1 ring-border transition-shadow outline-none placeholder:text-base placeholder:font-normal placeholder:tracking-[0.2em] placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}
