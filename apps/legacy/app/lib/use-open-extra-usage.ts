import { useNavigate } from "@tanstack/react-router";

import { openSettings } from "~/data/settings-controller";
import { useMinMd } from "~/lib/use-media";

/**
 * Returns a function that takes the user to the Extra Usage top-up. On desktop
 * it opens the settings modal on that tab; on mobile (where the modal is
 * cramped) it navigates to the full-page settings route instead.
 */
export function useOpenExtraUsage() {
  const navigate = useNavigate();
  const minMd = useMinMd();
  return () => {
    if (minMd) {
      openSettings("extra-usage");
    } else {
      void navigate({ to: "/settings", search: { section: "extra-usage" } });
    }
  };
}
