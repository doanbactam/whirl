"use client";

import { useMemo } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@whirl/backend/convex/_generated/api";

/* Client bindings for the integration store, v2 edition. Mirrors the main
   app's useMentionableIntegrations (apps/legacy/app/components/
   composer-mentions.tsx) — installs are the whole gate; plan limits are
   the backend's job. */

/** Something the user can @mention from the composer's plus menu. */
export type MentionTarget = {
  serverId: string;
  name: string;
  logoUrl: string | null;
  iconSvg?: string;
};

/**
 * The user's mentionable integrations: installed, enabled, and (for OAuth
 * ones) actually signed in. Empty while signed out or still loading.
 */
export function useMentionableIntegrations(): MentionTarget[] {
  const { isAuthenticated } = useConvexAuth();
  const installed = useQuery(
    api.integrationStore.listInstalled,
    isAuthenticated ? {} : "skip",
  );
  return useMemo(() => {
    if (!installed) return [];
    return installed
      .filter(
        (integration) =>
          integration.enabled &&
          (integration.authMode !== "oauth" || integration.oauthConnected),
      )
      .map((integration) => ({
        serverId: integration.serverId,
        name: integration.name,
        logoUrl: integration.logoUrl,
        iconSvg: integration.iconSvg,
      }));
  }, [installed]);
}
