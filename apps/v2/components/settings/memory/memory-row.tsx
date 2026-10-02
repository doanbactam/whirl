"use client";

import { useState } from "react";
import { IconPencil } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/integrations-data";
import { formatRelative } from "@/lib/relative-time";
import { showToast } from "@/lib/toasts";
import type { Memory } from "@/lib/user-memory";
import { ArmRemoveButton } from "../arm-remove-button";
import { MemoryTextarea } from "./memory-textarea";

/* One remembered fact. Reads as plain text until you edit it, at which point
   the row unfolds into the same field the add form uses — the settings
   pane's edit-in-place idiom, no dialogs. */
export function MemoryRow({
  memory,
  onSave,
  onForget,
}: {
  memory: Memory;
  onSave: (id: string, content: string) => Promise<void>;
  onForget: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.memory);
  const [saving, setSaving] = useState(false);

  const trimmed = draft.trim();
  const canSave = trimmed.length > 0 && trimmed !== memory.memory;

  const startEditing = () => {
    setDraft(memory.memory);
    setEditing(true);
  };

  const save = async () => {
    if (saving) return;
    if (!canSave) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(memory.id, trimmed);
      setEditing(false);
    } catch (error) {
      showToast(errorText(error, "Couldn't save that memory. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const forget = () => {
    onForget(memory.id).catch((error: unknown) =>
      showToast(errorText(error, "Couldn't forget that memory. Try again.")),
    );
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-2 px-4 py-3">
        <MemoryTextarea
          value={draft}
          onChange={setDraft}
          onSubmit={() => void save()}
          onCancel={() => setEditing(false)}
          placeholder="What should Whirl remember?"
          disabled={saving}
        />
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSave || saving}
            className="min-w-[60px]"
            onClick={() => void save()}
          >
            {saving ? <Spinner /> : "Save"}
          </Button>
        </div>
      </li>
    );
  }

  const stamp = memory.updatedAt ? formatRelative(memory.updatedAt) : null;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px]/[19px] break-words">{memory.memory}</p>
        {(memory.isStatic || stamp) && (
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            {[memory.isStatic ? "Always remembered" : null, stamp]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Edit this memory"
          className="text-muted-foreground"
          onClick={startEditing}
        >
          <IconPencil size={15} stroke={2} />
        </Button>
        <ArmRemoveButton
          label="this memory"
          confirmLabel="Forget?"
          onRemove={forget}
        />
      </div>
    </li>
  );
}
