"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@whirl/backend/convex/_generated/api";

import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toasts";
import { ToggleSwitch } from "../../toggle-switch";

/* The memory master switch. Only ever rendered inside the Memory tab's paid,
   signed-in branch, so there's no plan gate here — the backend re-checks
   anyway. An absent Convex row reads as on, matching the backend default. */
export function SupermemoryToggle() {
  const settings = useQuery(api.memory.getMemorySettings, {});
  const setEnabled = useMutation(api.memory.setMemoryEnabled);

  if (settings === undefined) {
    return <Skeleton className="h-4.5 w-8 rounded-full" />;
  }

  const toggle = async (next: boolean) => {
    try {
      await setEnabled({ enabled: next });
    } catch {
      showToast("Couldn't update memory. Try again.");
    }
  };

  return (
    <ToggleSwitch
      checked={settings.enabled}
      onCheckedChange={(next) => void toggle(next)}
      aria-label="Use memory"
    />
  );
}
