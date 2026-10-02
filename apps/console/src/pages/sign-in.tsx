import { SignIn } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";

import { WhirlMark } from "~/components/whirl-mark";
import { useIsDark } from "~/lib/theme";

/**
 * Signed-out landing: the console shares Whirl's Clerk instance, so an
 * existing Whirl account signs straight in. Clerk's prebuilt card handles the
 * flow; we dress the room around it.
 */
export function SignInPage() {
  const isDark = useIsDark();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-[#F3F3F3] px-4 py-12 dark:bg-[#141414]">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-2.5">
          <WhirlMark size={24} />
          <span className="text-[18px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Whirl
          </span>
          <span className="rounded-full border border-black/[0.1] px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:border-white/[0.14] dark:text-neutral-400">
            Console
          </span>
        </div>
        <p className="max-w-sm text-[13.5px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          Sign in with your Whirl account to manage your integrations and API
          keys.
        </p>
      </div>
      <SignIn
        routing="hash"
        appearance={{
          baseTheme: isDark ? dark : undefined,
          variables: {
            colorPrimary: "#0c82f2",
            borderRadius: "0.75rem",
          },
        }}
      />
    </div>
  );
}
