// "Gmail stopped working" answered with which integration, since when, and
// what fixes it. Never returns a URL, header, or token: only names and states.

import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { assertSupportSecret } from "./guard";

/* Installs are capped well below this in the store. */
const MAX_SERVERS = 50;
const MAX_ERROR_CHARS = 200;

type IntegrationState =
  | "working"
  | "needs_reconnect"
  | "credentials_rejected"
  | "erroring"
  | "not_connected"
  | "paused";

/* Mirrors integrationStatus in apps/v2/components/settings/integrations/
   installed-row.tsx, check for check, so the agent never contradicts the
   status line the customer is looking at. */
function stateOf(server: Doc<"mcpServers">): {
  state: IntegrationState;
  fix: string | null;
} {
  const signsIn = server.authMode === "oauth" || server.composio !== undefined;
  if (server.authExpiredAt !== undefined) {
    return signsIn
      ? {
          state: "needs_reconnect",
          fix: "Its sign-in expired or was revoked. Reconnect it from Settings > Integrations.",
        }
      : {
          state: "credentials_rejected",
          fix: "The keys it was installed with stopped working. Remove it and install it again with fresh keys.",
        };
  }
  if (server.lastError) {
    return {
      state: "erroring",
      fix: "Whirl reached it but it answered with an error. Retrying later, or removing and re-adding it, usually clears it.",
    };
  }
  const oauthPending = server.authMode === "oauth" && !server.oauth?.connected;
  const composioPending = server.composio !== undefined && !server.composio.connected;
  if (oauthPending || composioPending) {
    return {
      state: "not_connected",
      fix: "It was installed but the account connection never finished. Press Connect on it in Settings > Integrations.",
    };
  }
  if (!server.enabled) {
    return {
      state: "paused",
      fix: "It's paused in Settings > Integrations. Switching it back on restores it.",
    };
  }
  return { state: "working", fix: null };
}

export const integrationStatus = query({
  args: { secret: v.string(), externalId: v.string() },
  handler: async (ctx, { secret, externalId }) => {
    assertSupportSecret(secret);

    const servers = await ctx.db
      .query("mcpServers")
      .withIndex("by_user", (q) => q.eq("userId", externalId))
      .take(MAX_SERVERS);

    return {
      integrations: servers.map((server) => {
        const { state, fix } = stateOf(server);
        return {
          name: server.name,
          fromStore: server.integrationId !== undefined,
          state,
          fix,
          brokeAt: server.authExpiredAt ?? null,
          lastConnectedAt: server.lastConnectedAt ?? null,
          lastError:
            state === "erroring" && server.lastError
              ? server.lastError.slice(0, MAX_ERROR_CHARS)
              : null,
        };
      }),
    };
  },
});
