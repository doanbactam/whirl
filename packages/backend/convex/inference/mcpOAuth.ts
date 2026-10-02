// OAuth 2.1 client for remote MCP servers: metadata discovery, Dynamic Client
// Registration (RFC 7591), the authorization-code + PKCE flow, and token
// refresh. All over `fetch` + Web Crypto so it stays in Convex's default
// runtime (no Node), same as the rest of the inference layer.
//
// We support DCR only: the user clicks "Connect", we discover the server's
// authorization server, register a public client, and send them through the
// consent flow. Servers that don't advertise OAuth metadata or DCR can't be
// connected this way (they can still use static headers).

import { ConvexError } from "convex/values";

import { assertSafeFetchUrl } from "./urlSafety";

const DISCOVERY_TIMEOUT_MS = 8_000;

export type AuthServerMetadata = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
  /** The canonical resource indicator (RFC 8707) to bind tokens to. */
  resource: string;
};

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  /** Absolute expiry in ms epoch, when the server reported `expires_in`. */
  expiresAt?: number;
};

// --- base64url + PKCE helpers ----------------------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A random URL-safe token (state, or a PKCE code verifier). */
export function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToBase64Url(bytes);
}

/** PKCE S256 challenge for a verifier: base64url(SHA-256(verifier)). */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

// --- discovery --------------------------------------------------------------

async function fetchJson(
  url: string,
  signal: AbortSignal,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Discover the authorization server for an MCP endpoint. Tries OAuth Protected
 * Resource Metadata (RFC 9728) to find the authorization server, then that
 * server's metadata (RFC 8414 / OpenID Connect discovery) for the endpoints.
 * Falls back to treating the resource origin as its own authorization server.
 */
export async function discoverAuthServer(
  mcpUrl: string,
): Promise<AuthServerMetadata> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const url = assertSafeFetchUrl(mcpUrl);
    const origin = url.origin;
    const pathSuffix = url.pathname && url.pathname !== "/" ? url.pathname : "";

    // 1. Protected Resource Metadata → which authorization server to use.
    const prm =
      (await fetchJson(
        `${origin}/.well-known/oauth-protected-resource${pathSuffix}`,
        controller.signal,
      )) ?? (await fetchJson(`${origin}/.well-known/oauth-protected-resource`, controller.signal));

    const authServers = prm?.authorization_servers;
    const authServerUrl =
      (Array.isArray(authServers) && asString(authServers[0])) || origin;
    const resource = asString(prm?.resource) ?? mcpUrl;

    // 2. Authorization Server Metadata → the actual endpoints. Try the RFC 8414
    // and OpenID Connect well-known locations against the discovered server.
    // authServerUrl is provider-controlled (it came back in the PRM response),
    // so re-validate it before we fetch it.
    const asBase = assertSafeFetchUrl(authServerUrl);
    const asOrigin = asBase.origin;
    const asPath =
      asBase.pathname && asBase.pathname !== "/" ? asBase.pathname : "";
    const candidates = [
      `${asOrigin}/.well-known/oauth-authorization-server${asPath}`,
      `${asOrigin}/.well-known/openid-configuration${asPath}`,
      `${asOrigin}/.well-known/oauth-authorization-server`,
      `${asOrigin}/.well-known/openid-configuration`,
    ];

    let meta: Record<string, unknown> | null = null;
    for (const candidate of candidates) {
      meta = await fetchJson(candidate, controller.signal);
      if (meta?.authorization_endpoint && meta?.token_endpoint) break;
      meta = null;
    }

    const authorizationEndpoint = asString(meta?.authorization_endpoint);
    const tokenEndpoint = asString(meta?.token_endpoint);
    if (!authorizationEndpoint || !tokenEndpoint) {
      throw new Error(
        "This server doesn't advertise OAuth (no authorization metadata found).",
      );
    }
    const registrationEndpoint = asString(meta?.registration_endpoint);
    // These endpoints are provider-controlled; we POST secrets to the token /
    // registration ones and send the user to the authorization one. Make sure
    // they're public https before we trust them.
    assertSafeFetchUrl(authorizationEndpoint);
    assertSafeFetchUrl(tokenEndpoint);
    if (registrationEndpoint) assertSafeFetchUrl(registrationEndpoint);

    const scopesSupported = Array.isArray(meta?.scopes_supported)
      ? (meta!.scopes_supported as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : undefined;

    return {
      authorizationEndpoint,
      tokenEndpoint,
      registrationEndpoint,
      scopesSupported,
      resource,
    };
  } finally {
    clearTimeout(timer);
  }
}

// --- dynamic client registration -------------------------------------------

export type RegisteredClient = {
  clientId: string;
  clientSecret?: string;
  /** The scope the server actually granted — may differ from what we asked for. */
  scope?: string;
};

/**
 * A readable failure for a DCR error response. Some servers only accept
 * redirect URIs from a hardcoded allowlist of clients (Claude, Cursor, ...) —
 * that's a policy we can't register our way around, so say so plainly instead
 * of echoing raw JSON.
 */
function registrationFailure(status: number, text: string): Error {
  let code: string | undefined;
  let description: string | undefined;
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    code = asString(data.error);
    description = asString(data.error_description);
  } catch {
    // Not JSON — fall through to the raw body.
  }
  if (code === "invalid_redirect_uri") {
    return new Error(
      "This server only allows a fixed set of apps to sign in and rejected Whirl's callback URL, so OAuth won't work here. Connect it with an API key or auth header instead.",
    );
  }
  const detail = description ?? text.slice(0, 200);
  return new Error(
    `Client registration failed (HTTP ${status})${detail ? `: ${detail}` : ""}`,
  );
}

/** Register a public client via Dynamic Client Registration (RFC 7591). */
export async function registerClient({
  registrationEndpoint,
  redirectUri,
  scope,
}: {
  registrationEndpoint: string;
  redirectUri: string;
  scope?: string;
}): Promise<RegisteredClient> {
  assertSafeFetchUrl(registrationEndpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const register = (requestScope?: string) =>
      fetch(registrationEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          client_name: "Whirl",
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          ...(requestScope ? { scope: requestScope } : {}),
        }),
      });

    let requestedScope = scope;
    let res = await register(scope);
    if (!res.ok && scope && res.status === 400) {
      // Some servers advertise scopes_supported that DCR clients aren't allowed
      // to request (invalid_scope). Retry scopeless and let the server assign
      // its defaults.
      const text = await res.text().catch(() => "");
      if (!text.includes("invalid_scope")) {
        throw registrationFailure(res.status, text);
      }
      requestedScope = undefined;
      res = await register(undefined);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw registrationFailure(res.status, text);
    }
    const data = (await res.json()) as Record<string, unknown>;
    const clientId = asString(data.client_id);
    if (!clientId) throw new Error("Registration returned no client_id.");
    return {
      clientId,
      clientSecret: asString(data.client_secret),
      scope: asString(data.scope) ?? requestedScope,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The front half of every "Connect" flow: discover the authorization server
 * for an MCP endpoint and register a client for `redirectUri`. Failures here
 * are user-actionable (bad URL, no DCR, Whirl not on the server's client
 * allowlist), and Convex redacts plain `Error` messages to "Server Error" in
 * production — so anything thrown is wrapped in a ConvexError, whose payload
 * survives to the browser.
 */
export async function discoverAndRegister({
  mcpUrl,
  redirectUri,
}: {
  mcpUrl: string;
  redirectUri: string;
}): Promise<{ meta: AuthServerMetadata; client: RegisteredClient }> {
  try {
    const meta = await discoverAuthServer(mcpUrl);
    if (!meta.registrationEndpoint) {
      throw new Error(
        "This server doesn't support automatic sign-in (no client registration endpoint).",
      );
    }
    const client = await registerClient({
      registrationEndpoint: meta.registrationEndpoint,
      redirectUri,
      // Ask for everything the server advertises; registration may narrow it.
      scope: meta.scopesSupported?.length
        ? meta.scopesSupported.join(" ")
        : undefined,
    });
    return { meta, client };
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    throw new ConvexError(
      error instanceof Error
        ? error.message
        : "Couldn't set up sign-in for this server.",
    );
  }
}

// --- authorization URL + token exchange ------------------------------------

export function buildAuthorizationUrl({
  authorizationEndpoint,
  clientId,
  redirectUri,
  scope,
  state,
  codeChallenge,
  resource,
}: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  state: string;
  codeChallenge: string;
  resource?: string;
}): string {
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (scope) url.searchParams.set("scope", scope);
  if (resource) url.searchParams.set("resource", resource);
  return url.toString();
}

async function postToken(
  tokenEndpoint: string,
  params: Record<string, string | undefined>,
  clientSecret?: string,
): Promise<OAuthTokens> {
  assertSafeFetchUrl(tokenEndpoint);
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) body.set(key, value);
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  // Confidential clients (DCR handed us a secret) authenticate at the token
  // endpoint; public clients rely on PKCE alone.
  if (clientSecret && params.client_id) {
    headers.Authorization = `Basic ${btoa(`${params.client_id}:${clientSecret}`)}`;
  }

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers,
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Token request failed (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }
  const data = (await res.json()) as Record<string, unknown>;
  const accessToken = asString(data.access_token);
  if (!accessToken) throw new Error("Token response had no access_token.");
  const expiresIn =
    typeof data.expires_in === "number" ? data.expires_in : undefined;
  return {
    accessToken,
    refreshToken: asString(data.refresh_token),
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
  };
}

/** Exchange an authorization code for tokens (callback step). */
export async function exchangeCode({
  tokenEndpoint,
  clientId,
  clientSecret,
  code,
  codeVerifier,
  redirectUri,
  resource,
}: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  resource?: string;
}): Promise<OAuthTokens> {
  return postToken(
    tokenEndpoint,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
      resource,
    },
    clientSecret,
  );
}

/** Trade a refresh token for a fresh access token. */
export async function refreshAccessToken({
  tokenEndpoint,
  clientId,
  clientSecret,
  refreshToken,
  resource,
  scope,
}: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  resource?: string;
  scope?: string;
}): Promise<OAuthTokens> {
  const tokens = await postToken(
    tokenEndpoint,
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      resource,
      scope,
    },
    clientSecret,
  );
  // Some servers omit the refresh token on refresh; keep reusing the old one.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

// --- bearer resolution ------------------------------------------------------

export type DecryptedOAuth = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  resource?: string;
  scope?: string;
};

/** Treat a token as expired this far before its real expiry. */
const REFRESH_SKEW_MS = 60_000;

/**
 * Return a usable access token for an OAuth server, refreshing first when the
 * current one is missing or about to expire. `onRefreshed` persists the new
 * tokens (re-encrypting them) before they're handed back. Returns null when the
 * server has never been connected and can't be refreshed.
 */
export async function resolveBearer(
  oauth: DecryptedOAuth,
  onRefreshed: (tokens: OAuthTokens) => Promise<void>,
): Promise<string | null> {
  const valid =
    oauth.accessToken &&
    (!oauth.expiresAt || oauth.expiresAt > Date.now() + REFRESH_SKEW_MS);
  if (valid) return oauth.accessToken!;

  if (oauth.refreshToken) {
    const tokens = await refreshAccessToken({
      tokenEndpoint: oauth.tokenEndpoint,
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      refreshToken: oauth.refreshToken,
      resource: oauth.resource,
      scope: oauth.scope,
    });
    await onRefreshed(tokens);
    return tokens.accessToken;
  }

  // No refresh token: fall back to whatever access token we have (may be valid
  // for non-expiring grants), otherwise signal "not connected".
  return oauth.accessToken ?? null;
}
