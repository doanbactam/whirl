import { decryptSecret, encryptSecret } from "./crypto";
import type { McpHeader, McpServerConfig } from "./mcp";
import { resolveBearer, type OAuthTokens } from "./mcpOAuth";

/**
 * Turning the user's stored MCP server rows into callable configs — decrypting
 * headers, and refreshing an OAuth grant when it has aged out.
 *
 * This used to live inline in the stream loop, which was fine while the model
 * was the only thing that ever called an integration. Artifact data bindings
 * call them too, from a plain action with no stream around it, and the two
 * paths have to agree exactly on which servers are reachable — so it lives
 * here, and both import it.
 */

/** A stored server row, as the request-info query hands it over. */
export type StoredMcpServer = {
  id: string;
  name: string;
  url: string;
  authMode?: string;
  headers: { key: string; valueCipher: string }[];
  oauth?: {
    clientId: string;
    clientSecretCipher?: string;
    tokenEndpoint: string;
    scope?: string;
    resource?: string;
    accessTokenCipher?: string;
    refreshTokenCipher?: string;
    expiresAt?: number;
    connected?: boolean;
  };
};

/**
 * Resolve every server that can actually be reached right now. A server whose
 * grant is missing, or whose refresh fails, drops out rather than throwing:
 * one broken integration must never take down a turn (or a dashboard) that
 * doesn't depend on it.
 *
 * Dropping out quietly is what it must NOT do, though. A refresh that fails is
 * an expired sign-in — permanent until the user reconnects — and swallowing it
 * is how an integration ends up looking connected in settings while every
 * dashboard built on it renders an empty state. `onAuthExpired` is how that
 * gets recorded; callers with no way to persist can omit it.
 */
export async function resolveMcpServerConfigs(
  servers: StoredMcpServer[],
  {
    persistRefreshedTokens,
    onAuthExpired,
  }: {
    persistRefreshedTokens: (args: {
      serverId: string;
      accessTokenCipher: string;
      refreshTokenCipher?: string;
      expiresAt?: number;
    }) => Promise<void>;
    /** The stored grant stopped working; the row needs a reconnect. */
    onAuthExpired?: (args: {
      serverId: string;
      reason: string;
    }) => Promise<void>;
  },
): Promise<McpServerConfig[]> {
  const configs = await Promise.all(
    servers.map(async (server) => {
      if (server.authMode === "oauth") {
        const o = server.oauth;
        // No tokens at all is "never connected", not "expired" — the row
        // already says so, and shouting about it would be wrong.
        if (!o || (!o.accessTokenCipher && !o.refreshTokenCipher)) return null;
        try {
          const bearer = await resolveBearer(
            {
              accessToken: o.accessTokenCipher
                ? await decryptSecret(o.accessTokenCipher)
                : undefined,
              refreshToken: o.refreshTokenCipher
                ? await decryptSecret(o.refreshTokenCipher)
                : undefined,
              expiresAt: o.expiresAt,
              tokenEndpoint: o.tokenEndpoint,
              clientId: o.clientId,
              clientSecret: o.clientSecretCipher
                ? await decryptSecret(o.clientSecretCipher)
                : undefined,
              resource: o.resource,
              scope: o.scope,
            },
            async (tokens: OAuthTokens) => {
              await persistRefreshedTokens({
                serverId: server.id,
                accessTokenCipher: await encryptSecret(tokens.accessToken),
                refreshTokenCipher: tokens.refreshToken
                  ? await encryptSecret(tokens.refreshToken)
                  : undefined,
                expiresAt: tokens.expiresAt,
              });
            },
          );
          if (!bearer) {
            await onAuthExpired?.({
              serverId: server.id,
              reason: "Sign-in expired. Reconnect to keep using this.",
            });
            return null;
          }
          return {
            id: server.id,
            name: server.name,
            url: server.url,
            headers: [{ key: "Authorization", value: `Bearer ${bearer}` }],
          } satisfies McpServerConfig;
        } catch (error) {
          // The refresh itself was rejected — the grant is gone for good.
          await onAuthExpired?.({
            serverId: server.id,
            reason:
              error instanceof Error && error.message
                ? `Sign-in expired: ${error.message}`
                : "Sign-in expired. Reconnect to keep using this.",
          });
          return null;
        }
      }

      const headers = (
        await Promise.all(
          server.headers.map(async (h) => {
            try {
              return {
                key: h.key,
                value: await decryptSecret(h.valueCipher),
              } satisfies McpHeader;
            } catch {
              // A header we can't decrypt is dropped, not fatal — the server
              // may still authenticate on the ones that survived.
              return null;
            }
          }),
        )
      ).filter((h): h is McpHeader => h !== null);

      return {
        id: server.id,
        name: server.name,
        url: server.url,
        headers,
      } satisfies McpServerConfig;
    }),
  );

  return configs.filter((c): c is NonNullable<typeof c> => c !== null);
}

/** Match an integration name the same way the model's gateway does. */
export function findMcpServer(
  servers: McpServerConfig[],
  name: string,
): McpServerConfig | undefined {
  const wanted = name.trim().toLowerCase();
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  return (
    servers.find((s) => s.name.trim().toLowerCase() === wanted) ??
    servers.find((s) => slug(s.name) === slug(name))
  );
}
