"use client";

import { useMemo } from "react";
import { useQueries } from "convex/react";

import { api } from "@whirl/backend/convex/_generated/api";
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "@/lib/settings-sections";

/* The optional services this deployment has switched on (convex/features.ts).
   A self-hosted Whirl can run without billing, web search or long-term
   memory, and the controls for each hide instead of failing.

   Until the live answer lands, assume everything is on: the hosted app then
   never flashes a control away from someone who has it, and a self-hosted
   one tucks its extras away a beat after load. Every caller shares one
   Convex subscription. */

export type DeploymentFeatures = {
  billing: boolean;
  search: boolean;
  memory: boolean;
};

const ASSUME_ALL_ON: DeploymentFeatures = {
  billing: true,
  search: true,
  memory: true,
};

/* useQueries, not useQuery: it hands a failed query back as an Error instead
   of throwing it into the tree. This hook sits under the composer and the
   user menu, so a web build that ships a minute before its backend (which
   doesn't have features.get yet) must fall back to "everything on", never
   take the whole app down. */
const FEATURES_QUERY = { features: { query: api.features.get, args: {} } };

export function useDeploymentFeatures(): DeploymentFeatures {
  const { features } = useQueries(FEATURES_QUERY);
  return features === undefined || features instanceof Error
    ? ASSUME_ALL_ON
    : (features as DeploymentFeatures);
}

/** The settings sections worth showing: billing's and memory's tabs only
 *  exist where those services are configured. */
export function useSettingsSections(): readonly SettingsSection[] {
  const { billing, memory } = useDeploymentFeatures();
  return useMemo(
    () =>
      SETTINGS_SECTIONS.filter((section) => {
        if (section === "billing" || section === "extra-usage") return billing;
        if (section === "memory") return memory;
        return true;
      }),
    [billing, memory],
  );
}
