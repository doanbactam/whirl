import { MultiplierSection } from "./multiplier-section";
import { ResetUsageSection } from "./reset-usage-section";

/** Admin-only operational controls ported from the original Whirl admin page. */
export function AdminPage() {
  return (
    <>
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Usage controls
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
          Run usage events and reset customer quotas. Every read and action is
          verified against the admin role on the backend.
        </p>
      </div>

      <div className="mt-6 space-y-6">
        <MultiplierSection />
        <ResetUsageSection />
      </div>
    </>
  );
}
