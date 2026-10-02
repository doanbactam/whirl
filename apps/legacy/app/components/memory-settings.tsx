import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/tanstack-react-start";
import { useCustomer } from "autumn-js/react";
import { motion } from "motion/react";
import type { TablerIcon } from "@tabler/icons-react";
import {
  IconCheck,
  IconPencil,
  IconSparkles,
  IconTrash,
  IconX,
} from "@tabler/icons-react";

import { Spinner } from "~/components/spinner";
import { useMemorySettings, type Memory } from "~/data/memory";
import { readFreeMessages } from "~/lib/messages";
import { showToast } from "~/data/toasts";
import { useUpgrade } from "~/components/upgrade-modal";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

const MAX_MEMORY_LENGTH = 300;

/**
 * The Supermemory on/off control that lives in General settings. Free users see
 * an upgrade nudge instead of the toggle, since memory is a paid perk. Pair it
 * with a `Row` for the label and description.
 */
export function SupermemoryControl() {
  const { isSignedIn } = useUser();
  const { customer, isLoading } = useCustomer();
  const free = readFreeMessages(customer);
  const { settings, setEnabled } = useMemorySettings(!free.isFree);
  const capture = useCapture();
  const { open } = useUpgrade();

  const enabled = settings?.enabled ?? true;

  const toggle = async (next: boolean) => {
    try {
      await setEnabled({ enabled: next });
      capture(ANALYTICS_EVENTS.memoryToggled, { enabled: next });
    } catch {
      showToast({
        message: "Couldn't update memory. Try again.",
        tone: "danger",
      });
    }
  };

  // Signed in + no customer = still loading — don't flash the upgrade nudge.
  if (!customer && (isLoading || isSignedIn)) {
    return <Spinner size={14} className="text-blue-500" />;
  }

  if (free.isFree) {
    return (
      <button
        type="button"
        onClick={() => open("memory")}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[13px] font-medium text-white transition hover:bg-blue-500"
      >
        <IconSparkles size={14} stroke={2} />
        See plans
      </button>
    );
  }

  return (
    <Switch
      checked={enabled}
      disabled={settings === undefined}
      onChange={(next) => void toggle(next)}
    />
  );
}

export function MemoryRow({
  memory,
  onSave,
  onDelete,
}: {
  memory: Memory;
  onSave: (args: { id: string; text: string }) => Promise<unknown>;
  onDelete: (args: { id: string }) => Promise<unknown>;
}) {
  const capture = useCapture();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(memory.text);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setValue(memory.text);
  }, [memory.text, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing]);

  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed !== memory.text;

  const save = async () => {
    if (!canSave || busy) {
      setEditing(false);
      setValue(memory.text);
      return;
    }
    setBusy(true);
    try {
      await onSave({ id: memory.id, text: trimmed });
      capture(ANALYTICS_EVENTS.memoryEdited);
      setEditing(false);
    } catch {
      showToast({
        message: "Couldn't save that memory. Try again.",
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onDelete({ id: memory.id });
      capture(ANALYTICS_EVENTS.memoryDeleted);
    } catch {
      showToast({
        message: "Couldn't delete that memory. Try again.",
        tone: "danger",
      });
      setBusy(false);
    }
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
      className="group/mem flex items-start gap-2 px-3 py-2.5"
    >
      <span className="mt-1.5 flex h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/70 dark:bg-emerald-400/70" />
      {editing ? (
        <textarea
          ref={inputRef}
          value={value}
          rows={1}
          maxLength={MAX_MEMORY_LENGTH}
          onChange={(e) => {
            setValue(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              setValue(memory.text);
            }
          }}
          onBlur={() => void save()}
          className="min-w-0 flex-1 resize-none rounded-md border border-black/[0.1] bg-white px-2 py-1 text-[13px] leading-relaxed text-neutral-900 outline-none focus-visible:border-black/25 dark:border-white/[0.14] dark:bg-[#222] dark:text-neutral-100 dark:focus-visible:border-white/35"
        />
      ) : (
        <span className="min-w-0 flex-1 break-words text-[13px] leading-relaxed text-neutral-800 dark:text-neutral-200">
          {memory.text}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        {editing ? (
          <IconButton
            icon={IconCheck}
            label="Save"
            disabled={busy}
            onClick={() => void save()}
          />
        ) : (
          <IconButton
            icon={IconPencil}
            label="Edit"
            className="opacity-0 group-hover/mem:opacity-100 focus-visible:opacity-100"
            onClick={() => setEditing(true)}
          />
        )}
        <IconButton
          icon={editing ? IconX : IconTrash}
          label={editing ? "Cancel" : "Delete"}
          disabled={busy}
          danger={!editing}
          className={
            editing ? "" : "opacity-0 group-hover/mem:opacity-100 focus-visible:opacity-100"
          }
          onClick={() => {
            if (editing) {
              setEditing(false);
              setValue(memory.text);
            } else {
              void remove();
            }
          }}
        />
      </div>
    </motion.li>
  );
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
  className = "",
}: {
  icon: TablerIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-[opacity,background-color,color] hover:bg-black/[0.05] disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-white/[0.06] ${
        danger
          ? "hover:text-red-600 dark:hover:text-red-300"
          : "hover:text-neutral-800 dark:hover:text-neutral-100"
      } ${className}`}
    >
      <Icon size={14} stroke={2} />
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked
          ? "bg-emerald-500 dark:bg-emerald-500"
          : "bg-black/15 dark:bg-white/20"
      }`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm ${
          checked ? "ml-[18px]" : "ml-0.5"
        }`}
      />
    </button>
  );
}
