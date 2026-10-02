import { useAction, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";

/** One MCP server as the client sees it — never any secret values. */
export type McpServer = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  authMode: "headers" | "oauth";
  headers: { key: string; hasValue: boolean }[];
  /** OAuth servers only: whether a valid grant is stored. */
  oauthConnected: boolean;
  lastConnectedAt?: number;
  lastError?: string;
  updatedAt: number;
};

export type McpAuthMode = "headers" | "oauth";

/** A header row in the add/edit form. `value` blank means "keep existing". */
export type McpHeaderInput = { key: string; value?: string };

export type TestConnectionResult = {
  ok: boolean;
  toolCount: number;
  tools: { name: string; description?: string }[];
  error?: string;
};

const listServersRef = makeFunctionReference<"query">("mcpServers:listServers");
const addServerRef = makeFunctionReference<"mutation">("mcpServers:addServer");
const updateServerRef = makeFunctionReference<"mutation">(
  "mcpServers:updateServer",
);
const setServerEnabledRef = makeFunctionReference<"mutation">(
  "mcpServers:setServerEnabled",
);
const removeServerRef = makeFunctionReference<"mutation">(
  "mcpServers:removeServer",
);
const testConnectionRef = makeFunctionReference<"action">(
  "mcpServers:testConnection",
);
const startOAuthRef = makeFunctionReference<"action">(
  "mcpOAuthFlow:startOAuth",
);
const disconnectOAuthRef = makeFunctionReference<"mutation">(
  "mcpOAuthFlow:disconnectOAuth",
);

/**
 * Open a sign-in popup and point it at whatever URL `getUrl` resolves. The
 * blank popup is opened synchronously (so the browser counts it as
 * user-initiated) and navigated once the URL arrives; if the popup was
 * blocked we fall back to a full-page redirect. Shared by MCP OAuth and the
 * Composio connect flow — both callbacks post the same `mcp-oauth` message
 * and the reactive queries flip rows to "connected" on their own.
 */
export async function openAuthPopup(getUrl: () => Promise<string>) {
  const popup =
    typeof window !== "undefined"
      ? window.open("", "mcp-oauth", "width=520,height=720")
      : null;
  try {
    const url = await getUrl();
    if (popup && !popup.closed) {
      popup.location.href = url;
    } else {
      window.location.href = url;
    }
  } catch (error) {
    popup?.close();
    throw error;
  }
}

/** The OAuth consent popup for an MCP server (see openAuthPopup). */
export async function openOAuthPopup(
  startOAuth: (args: { id: string }) => Promise<{ authorizationUrl: string }>,
  serverId: string,
): Promise<void> {
  await openAuthPopup(
    async () => (await startOAuth({ id: serverId })).authorizationUrl,
  );
}

/** The signed-in user's MCP servers, plus all the mutators. */
export function useMcpServers(enabled: boolean) {
  const servers = useQuery(listServersRef, enabled ? {} : "skip") as
    | McpServer[]
    | undefined;
  return {
    servers,
    addServer: useMutation(addServerRef),
    updateServer: useMutation(updateServerRef),
    setServerEnabled: useMutation(setServerEnabledRef),
    removeServer: useMutation(removeServerRef),
    testConnection: useAction(testConnectionRef),
    startOAuth: useAction(startOAuthRef),
    disconnectOAuth: useMutation(disconnectOAuthRef),
  };
}
