import { useMemo } from "react";

import { useInstalledIntegrations } from "~/data/integrationStore";

/** Loose name match, mirroring the backend gateway's tolerance for the
 * model's casing/spacing when it names an integration. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "server"
  );
}

export type IntegrationActivity = {
  /** Store branding for the integration behind a phase's server name. */
  branding: { name: string; logoUrl: string | null; iconSvg?: string } | null;
  /**
   * The developer-written action phrase for the running tool ("Searching
   * your issues") — chat's status line while the tool runs.
   */
  action: string | null;
  /**
   * Its past-tense sibling ("Searched your issues"), shown once the call
   * finishes. Null on listings that predate the completed-state field.
   */
  completed: string | null;
  /**
   * True while the installed list hasn't loaded yet, so a phase that *might*
   * be branded can hold off instead of flashing the generic plug first.
   */
  loading: boolean;
};

const NO_ACTIVITY: IntegrationActivity = {
  branding: null,
  action: null,
  completed: null,
  loading: false,
};

const LOADING_ACTIVITY: IntegrationActivity = { ...NO_ACTIVITY, loading: true };

/**
 * Resolve an `mcp` phase's server/tool names to the installed integration's
 * branding and the developer's action phrase for that tool. Nulls for
 * hand-added MCP servers (no store listing) and uninstalled integrations —
 * callers fall back to the generic plug + whimsy.
 */
export function useIntegrationActivity(
  server?: string,
  tool?: string,
): IntegrationActivity {
  const { installed } = useInstalledIntegrations();
  return useMemo(() => {
    if (!server) return NO_ACTIVITY;
    if (!installed) return LOADING_ACTIVITY;
    const wanted = server.trim().toLowerCase();
    const match =
      installed.find((i) => i.name.trim().toLowerCase() === wanted) ??
      installed.find((i) => slugify(i.name) === slugify(server));
    if (!match) return NO_ACTIVITY;
    const entry = tool ? match.tools.find((t) => t.name === tool) : undefined;
    return {
      branding: {
        name: match.name,
        logoUrl: match.logoUrl,
        iconSvg: match.iconSvg,
      },
      action: entry?.description?.trim() || null,
      completed: entry?.completed?.trim() || null,
      loading: false,
    };
  }, [installed, server, tool]);
}
