import { useAction, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";

// Client bindings for the integration store (convex/integrationStore.ts).
// Installs are mcpServers rows under the hood, so enable/disable, delete, and
// the OAuth consent flow reuse the plain MCP server functions.

export type IntegrationAuthMode = "none" | "oauth" | "apiKey";

/** One store listing as the browse tab sees it. */
export type StoreIntegration = {
  id: string;
  name: string;
  description?: string;
  author?: string;
  verified: boolean;
  logoUrl: string | null;
  bannerUrl: string | null;
  iconSvg?: string;
  authMode: IntegrationAuthMode;
  authFields: { key: string; label: string }[];
  authInstructions?: string;
  tools: { name: string; description: string; completed?: string }[];
  /** The caller's install of this listing, when they have one. */
  installedServerId: string | null;
  /** False while an install is still waiting on its sign-in (OAuth or
   * Composio connect). */
  installedConnected: boolean;
  /** True => installing runs Composio's hosted sign-in popup. */
  composioConnect: boolean;
};

/** One install row joined with its listing's branding, for the manage tab. */
export type InstalledIntegration = {
  serverId: string;
  name: string;
  description?: string;
  author?: string;
  verified: boolean;
  logoUrl: string | null;
  iconSvg?: string;
  /** Developer-written status phrases per tool: `description` while it runs
   * ("Searching your issues"), `completed` once it's done ("Searched your
   * issues" — absent on listings that predate the field). */
  tools: { name: string; description: string; completed?: string }[];
  authMode: IntegrationAuthMode;
  enabled: boolean;
  oauthConnected: boolean;
  /** This install authenticates through Composio's hosted connect flow… */
  composioConnect: boolean;
  /** …and whether the user's account is actually linked yet. */
  composioConnected: boolean;
  lastError?: string;
  installedAt: number;
};

const listStoreRef = makeFunctionReference<"query">(
  "integrationStore:listStore",
);
const listSuggestedRef = makeFunctionReference<"query">(
  "integrationStore:listSuggested",
);
const listInstalledRef = makeFunctionReference<"query">(
  "integrationStore:listInstalled",
);
// An action, not a mutation — the server checks the caller's plan with Autumn
// before writing (integrations are paid-only).
const installRef = makeFunctionReference<"action">("integrationStore:install");
const setServerEnabledRef = makeFunctionReference<"mutation">(
  "mcpServers:setServerEnabled",
);
const removeServerRef = makeFunctionReference<"mutation">(
  "mcpServers:removeServer",
);
const startOAuthRef = makeFunctionReference<"action">(
  "mcpOAuthFlow:startOAuth",
);
// Composio-backed installs sign in through Composio's hosted link flow
// instead of MCP OAuth; this mints the URL the popup opens.
const startComposioConnectRef = makeFunctionReference<"action">(
  "integrationStore:startComposioConnect",
);

/**
 * Just the install-flow actions, no storefront subscription — for surfaces
 * (like the chat's suggestion cards) that already know which listings they
 * show. Actions don't subscribe, so this costs nothing until used.
 */
export function useIntegrationInstallActions() {
  return {
    install: useAction(installRef) as (args: {
      id: string;
      secrets?: { key: string; value: string }[];
    }) => Promise<{ serverId: string }>,
    startOAuth: useAction(startOAuthRef) as (args: {
      id: string;
    }) => Promise<{ authorizationUrl: string }>,
    startComposioConnect: useAction(startComposioConnectRef) as (args: {
      id: string;
    }) => Promise<{ redirectUrl: string }>,
  };
}

/** The storefront plus everything needed to install from it. */
export function useIntegrationStore() {
  const integrations = useQuery(listStoreRef, {}) as
    | StoreIntegration[]
    | undefined;
  return {
    integrations,
    ...useIntegrationInstallActions(),
  };
}

/**
 * Live hydration for the chat's inline suggestion cards: the named listings in
 * store shape plus the caller's install state, reactive — installing one flips
 * its card to "Installed" without touching the message. Unlisted ids drop out.
 */
export function useSuggestedIntegrations(ids: string[]) {
  return useQuery(
    listSuggestedRef,
    ids.length > 0 ? { ids } : "skip",
  ) as StoreIntegration[] | undefined;
}

/** The signed-in user's installs plus the manage-tab mutators. */
export function useInstalledIntegrations() {
  const installed = useQuery(listInstalledRef, {}) as
    | InstalledIntegration[]
    | undefined;
  return {
    installed,
    setEnabled: useMutation(setServerEnabledRef) as (args: {
      id: string;
      enabled: boolean;
    }) => Promise<null>,
    uninstall: useMutation(removeServerRef) as (args: {
      id: string;
    }) => Promise<null>,
    startOAuth: useAction(startOAuthRef) as (args: {
      id: string;
    }) => Promise<{ authorizationUrl: string }>,
    startComposioConnect: useAction(startComposioConnectRef) as (args: {
      id: string;
    }) => Promise<{ redirectUrl: string }>,
  };
}
