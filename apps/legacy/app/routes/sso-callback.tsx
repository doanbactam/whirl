import { AuthenticateWithRedirectCallback } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";

import { Spinner } from "~/components/spinner";
import { Squircle } from "~/components/squircle";

export const Route = createFileRoute("/sso-callback")({
  component: SSOCallback,
});

function SSOCallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f8f8fa] px-4 py-10 dark:bg-[#171718]">
      <div className="w-full max-w-[400px]">
        <Squircle
          radius={24}
          className="flex flex-col items-center gap-5 rounded-[24px] border border-black/[0.06] bg-white px-6 py-10 shadow-[0_30px_80px_rgba(0,0,0,0.18),_0_4px_12px_rgba(0,0,0,0.08)] dark:border-white/[0.06] dark:bg-[#1A1A1A] dark:shadow-[0_30px_80px_rgba(0,0,0,0.7),_0_4px_12px_rgba(0,0,0,0.5)]"
        >
          <div className="relative h-10 w-10">
            <img src="/whirl.svg" alt="Whirl" className="h-10 w-10 dark:invert" />
          </div>
          <div className="flex flex-col items-center gap-1.5 text-center">
            <h2 className="text-[20px] font-medium tracking-tight text-neutral-900 dark:text-neutral-50">
              Signing you in
            </h2>
            <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
              Hang tight, finishing up your sign in…
            </p>
          </div>
          <Spinner size={20} className="text-blue-500" />
        </Squircle>
      </div>
      <AuthenticateWithRedirectCallback
        signInFallbackRedirectUrl="/"
        signUpFallbackRedirectUrl="/"
      />
    </div>
  );
}
