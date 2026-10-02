import { useCustomer } from "autumn-js/react";

import { useUpgrade } from "~/components/upgrade-modal";
import { useAuthGate } from "~/lib/auth-gate";
import { readFreeMessages } from "~/lib/messages";

/**
 * The auth + plan gates every install path runs before touching the store:
 * signed out prompts sign-in, free plans get the upgrade modal (integrations
 * and skills are both paid-only). Returns a callback shaped for the install
 * modal's `onBeforeInstall` — true means clear to proceed. Shared by the
 * integrations page and the chat's inline suggestion cards so the gating
 * never drifts. `reason` picks the upgrade modal's pitch copy.
 */
export function useIntegrationInstallGate(reason: "mcp" | "skills" = "mcp") {
  const { requireAuth } = useAuthGate();
  const { customer } = useCustomer();
  const { open: openUpgrade } = useUpgrade();

  return () => {
    if (!requireAuth()) return false;
    if (readFreeMessages(customer).isFree) {
      openUpgrade(reason);
      return false;
    }
    return true;
  };
}
