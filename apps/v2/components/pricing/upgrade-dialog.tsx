"use client";

import { IconX } from "@tabler/icons-react";

import { PaywallView } from "@/components/analytics/paywall-view";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlanPicker } from "./plan-picker";

export function UpgradeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <PaywallView source="upgrade_dialog" />}
      <DialogContent className="top-1/2 max-h-[calc(100dvh-2rem)] max-w-4xl -translate-y-1/2 overflow-y-auto p-5 sm:p-6">
        <DialogClose
          aria-label="Close plan picker"
          className="absolute top-3 right-3 flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <IconX size={16} />
        </DialogClose>
        <DialogHeader className="pr-10">
          <DialogTitle className="text-lg">Pick your next gear</DialogTitle>
          <p className="text-[13px]/5 text-muted-foreground">
            Every paid plan unlocks more models and more room to think. Switch
            or cancel whenever you like.
          </p>
        </DialogHeader>
        <div className="mt-5">
          <PlanPicker
            compact
            includeFree={false}
            onComplete={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
