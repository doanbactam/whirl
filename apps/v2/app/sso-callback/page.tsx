"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { IconLoader2 } from "@tabler/icons-react";

import { WhirlLogo } from "@/components/whirl-logo";

/* Where Google (or any future SSO provider) drops the user after consent.
   Clerk finishes the handshake invisibly; we just keep them company. */
export default function SSOCallbackPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-xl bg-popover px-6 py-10 ring-1 ring-border">
        <WhirlLogo size={36} />
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-lg font-semibold tracking-tight">
            Signing you in
          </h1>
          <p className="text-sm text-muted-foreground">
            Hang tight, finishing up your sign in…
          </p>
        </div>
        <IconLoader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
      <AuthenticateWithRedirectCallback
        signInFallbackRedirectUrl="/"
        signUpFallbackRedirectUrl="/"
      />
    </div>
  );
}
