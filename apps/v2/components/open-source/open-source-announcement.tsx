"use client";

import { useEffect, useRef, useState } from "react";
import { IconBrandGithubFilled } from "@tabler/icons-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import {
  StepHint,
  StepModal,
  StepModalCloseButton,
} from "@/components/ui/step-modal";
import { rise } from "@/lib/motion";
import {
  hasSeenOpenSourceAnnouncement,
  markOpenSourceAnnouncementSeen,
  REPO_LABEL,
  REPO_URL,
} from "@/lib/open-source";
import { OpenSourceHero } from "./open-source-hero";

/* A beat after the app paints, so the modal arrives on a settled page
   instead of racing the first frame. */
const OPEN_DELAY_MS = 1200;

/** Tells each browser, once, that Whirl's source is public. */
export function OpenSourceAnnouncement() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (hasSeenOpenSourceAnnouncement()) return;
    const timer = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <OpenSourceDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) markOpenSourceAnnouncementSeen();
        setOpen(next);
      }}
    />
  );
}

/** The announcement itself, ungated, so /debug can open it on demand. */
export function OpenSourceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const close = () => onOpenChange(false);
  /* This modal opens on its own, so there was no click: landing focus on
     the close button would light its ring for no reason. The body takes
     it instead, and Tab moves on to the button. */
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <StepModal
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Whirl is now open source"
      step="announcement"
      buttons={<StepModalCloseButton onClose={close} />}
      initialFocus={bodyRef}
    >
      <OpenSourceHero />
      <div
        ref={bodyRef}
        tabIndex={-1}
        className="flex flex-col items-center px-6 pt-5 pb-6 text-center outline-none"
      >
        <motion.h2
          {...rise(0.12)}
          className="text-[16px] font-semibold tracking-tight"
        >
          Whirl is now open source
        </motion.h2>
        <motion.p
          {...rise(0.17)}
          className="mt-1.5 max-w-[19rem] text-[13px]/[1.5] text-muted-foreground"
        >
          Every line of Whirl is public, from the composer to the streaming
          pipeline. Read the code, run your own, or help make it better.
        </motion.p>
        <motion.div {...rise(0.22)} className="mt-5 w-full">
          <Button
            nativeButton={false}
            render={<a href={REPO_URL} target="_blank" rel="noreferrer" />}
            onClick={close}
            className="h-10 w-full"
          >
            <IconBrandGithubFilled />
            View on GitHub
          </Button>
          <StepHint>
            {REPO_LABEL} · MIT license
          </StepHint>
        </motion.div>
      </div>
    </StepModal>
  );
}
