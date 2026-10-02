import { AvailabilitySection } from "./availability-section";
import { InterestSection } from "./interest-section";

/**
 * Admin control for the Platinum line: whether it's on sale, and who gets in
 * while it isn't. Approving a request mints that customer a Stripe checkout
 * link and emails it to them — nothing is charged until they use it.
 */
export function PlatinumPage() {
  return (
    <>
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Platinum
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
          Open the premium line, or decide who gets in while it's closed.
        </p>
      </div>

      <div className="mt-6 space-y-8">
        <AvailabilitySection />
        <InterestSection />
      </div>
    </>
  );
}
