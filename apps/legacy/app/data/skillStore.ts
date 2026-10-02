import { useAction, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";

// Client bindings for the store's Skills tab (convex/skillStore.ts). Installs
// are skillInstalls rows — no server, no auth flow, no quota; a skill is just
// text the model loads on demand.

/** One skill listing as the browse tab sees it. */
export type StoreSkill = {
  id: string;
  name: string;
  description?: string;
  author?: string;
  verified: boolean;
  logoUrl: string | null;
  bannerUrl: string | null;
  iconSvg?: string;
  /** Whether the caller already has this skill installed. */
  installed: boolean;
};

/** One install row joined with its listing's branding, for the manage tab. */
export type InstalledSkill = {
  installId: string;
  name: string;
  description?: string;
  author?: string;
  verified: boolean;
  logoUrl: string | null;
  iconSvg?: string;
  enabled: boolean;
  installedAt: number;
};

const listStoreRef = makeFunctionReference<"query">("skillStore:listStore");
const listInstalledRef = makeFunctionReference<"query">(
  "skillStore:listInstalled",
);
// An action, not a mutation — the server checks the caller's plan with Autumn
// before writing (skills are paid-only, like integrations).
const installRef = makeFunctionReference<"action">("skillStore:install");
const setInstallEnabledRef = makeFunctionReference<"mutation">(
  "skillStore:setInstallEnabled",
);
const uninstallRef = makeFunctionReference<"mutation">("skillStore:uninstall");

/** The skill storefront plus the install action. */
export function useSkillStore() {
  const skills = useQuery(listStoreRef, {}) as StoreSkill[] | undefined;
  return {
    skills,
    install: useAction(installRef) as (args: {
      id: string;
    }) => Promise<{ installId: string }>,
  };
}

/** The signed-in user's installed skills plus the manage-tab mutators. */
export function useInstalledSkills() {
  const installed = useQuery(listInstalledRef, {}) as
    | InstalledSkill[]
    | undefined;
  return {
    installed,
    setEnabled: useMutation(setInstallEnabledRef) as (args: {
      installId: string;
      enabled: boolean;
    }) => Promise<null>,
    uninstall: useMutation(uninstallRef) as (args: {
      installId: string;
    }) => Promise<null>,
  };
}
