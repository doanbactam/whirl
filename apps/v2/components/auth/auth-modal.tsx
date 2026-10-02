"use client";

import { useState } from "react";
import { IconX } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { WhirlLogo } from "@/components/whirl-logo";
import { stepMotion } from "./bits";
import { SignInPanel } from "./sign-in-panel";
import { SignUpPanel } from "./sign-up-panel";

type Mode = "sign-in" | "sign-up";

/* Custom Clerk auth (no prebuilt components): email + password with 2FA
   and password reset, email-code sign-up verification, and Google SSO.
   The panels own the flows; this is just the shell that swaps them. */
export function AuthModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label={mode === "sign-in" ? "Sign in to Whirl" : "Sign up for Whirl"}
        className="top-1/2 -translate-y-1/2 p-6"
      >
        <DialogClose
          aria-label="Close"
          className="absolute top-3 right-3 flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <IconX size={16} />
        </DialogClose>
        <div className="flex justify-center pt-1 pb-5">
          <WhirlLogo size={36} />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {mode === "sign-in" ? (
            <motion.div key="sign-in" {...stepMotion}>
              <SignInPanel onSwitch={() => setMode("sign-up")} onDone={close} />
            </motion.div>
          ) : (
            <motion.div key="sign-up" {...stepMotion}>
              <SignUpPanel onSwitch={() => setMode("sign-in")} onDone={close} />
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
