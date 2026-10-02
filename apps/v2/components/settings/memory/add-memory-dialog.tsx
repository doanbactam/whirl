"use client";

import { useState } from "react";

import { ToggleSwitch } from "@/components/toggle-switch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/integrations-data";
import { showToast } from "@/lib/toasts";
import { MemoryTextarea } from "./memory-textarea";

/* Write a memory by hand instead of waiting for Whirl to notice it.
   "Always remember" marks the fact as a permanent trait, which pins it to
   the top of the list and stops Supermemory ageing it out. */
export function AddMemoryDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (content: string, isStatic: boolean) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [always, setAlways] = useState(false);
  const [saving, setSaving] = useState(false);

  const trimmed = draft.trim();

  /* Clear on the way out rather than on the way in, so the next visit opens
     blank without an effect watching `open`. */
  const setOpen = (next: boolean) => {
    if (saving) return; // a dismiss shouldn't strand an in-flight save
    onOpenChange(next);
    if (!next) {
      setDraft("");
      setAlways(false);
    }
  };

  const close = () => setOpen(false);

  const save = async () => {
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onAdd(trimmed, always);
      setDraft("");
      setAlways(false);
      onOpenChange(false);
    } catch (error) {
      showToast(errorText(error, "Couldn't save that memory. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a memory</DialogTitle>
          <DialogDescription>
            Whirl will carry this into every chat, same as anything it picks
            up on its own.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3">
          <MemoryTextarea
            value={draft}
            onChange={setDraft}
            onSubmit={() => void save()}
            onCancel={close}
            placeholder="e.g. I'm allergic to shellfish — never suggest it"
            disabled={saving}
          />
        </div>

        <DialogFooter className="items-center justify-between">
          {/* The switch is presentational here: the whole row is the target. */}
          <button
            type="button"
            aria-pressed={always}
            disabled={saving}
            onClick={() => setAlways((value) => !value)}
            className="flex items-center gap-2 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
          >
            <ToggleSwitch checked={always} />
            Always remember this
          </button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" disabled={saving} onClick={close}>
              Cancel
            </Button>
            <Button
              disabled={!trimmed || saving}
              className="min-w-[88px]"
              onClick={() => void save()}
            >
              {saving ? <Spinner /> : "Remember"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
