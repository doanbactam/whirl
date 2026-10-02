import { jsonSchema, tool, type Tool } from "ai";

import {
  createMcpFailureDiagnostic,
  diagnosticFromHttpResponse,
  diagnosticFromMcpPayload,
  diagnosticFromThrownError,
  formatMcpFailureDiagnostic,
  isAuthFailure,
  McpFailureError,
  type McpFailureDiagnostic,
  withMcpIntegration,
  withMcpOperation,
} from "./mcpDiagnostics";
import { assertSafeFetchUrl } from "./urlSafety";

// A tiny MCP-over-HTTP client built on `fetch`. We deliberately avoid
// `@modelcontextprotocol/sdk` (Node-only deps that won't load in Convex's HTTP
// action runtime) and the AI SDK's `experimental_createMCPClient` (its built-in
// transport is SSE-only). MCP's Streamable-HTTP transport is just JSON-RPC 2.0
// over POST, so `initialize`, `tools/list` and `tools/call` are a handful of
// fetch calls. Some servers answer a POST with `text/event-stream`, so we parse
// that shape too. Only remote HTTP servers are supported (Convex can't spawn the
// local `stdio` kind).

const PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT_MS = 8_000;
/** Hard cap on tools returned by one `mcp_list_tools` call. */
export const MAX_MCP_TOOLS = 40;
/** Per-call cap on how much tool output we hand back to the model. */
const MAX_TOOL_RESULT_CHARS = 16_000;
/** Tool descriptions are prompt context; keep them useful, not sprawling. */
const MAX_TOOL_DESCRIPTION_CHARS = 480;
const MAX_SCHEMA_DESCRIPTION_CHARS = 240;

export type McpHeader = { key: string; value: string };

/** A server as the stream path knows it: label, endpoint, decrypted headers. */
export type McpServerConfig = {
  /** The Convex row id, echoed back via onServerError (position-independent). */
  id?: string;
  name: string;
  url: string;
  headers: McpHeader[];
};

export type McpToolDef = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

function baseHeaders(headers: McpHeader[], sessionId?: string) {
  const out: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
  };
  for (const { key, value } of headers) {
    if (key.trim()) out[key.trim()] = value;
  }
  if (sessionId) out["Mcp-Session-Id"] = sessionId;
  return out;
}

/**
 * Pull the JSON-RPC message matching `id` out of a response, whether it came
 * back as a single JSON body or an SSE (`text/event-stream`) stream of events.
 */
async function readRpcMessage(
  response: Response,
  id: number,
): Promise<JsonRpcMessage | null> {
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  if (!body) return null;

  if (contentType.includes("text/event-stream")) {
    for (const block of body.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        const msg = JSON.parse(data) as JsonRpcMessage;
        if (msg.id === id) return msg;
      } catch {
        // Ignore non-JSON SSE comments/keepalives.
      }
    }
    return null;
  }

  try {
    return JSON.parse(body) as JsonRpcMessage;
  } catch {
    return null;
  }
}

/** Open a session: `initialize` then the `notifications/initialized` ack. */
async function handshake(
  url: string,
  headers: McpHeader[],
  signal: AbortSignal,
): Promise<string | undefined> {
  // Both list + call routes start here, so this one guard covers every JSON-RPC
  // fetch against a server URL (https + non-internal host).
  assertSafeFetchUrl(url);
  const initRes = await fetch(url, {
    method: "POST",
    headers: baseHeaders(headers),
    signal,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "whirl", version: "1.0.0" },
      },
    }),
  });
  if (!initRes.ok) {
    throw new McpFailureError(
      await diagnosticFromHttpResponse("initialize", initRes),
    );
  }
  const sessionId = initRes.headers.get("mcp-session-id") ?? undefined;
  const msg = await readRpcMessage(initRes, 1);
  if (msg?.error) {
    throw new McpFailureError(
      diagnosticFromMcpPayload(
        "initialize",
        msg.error,
        msg.error.message ?? "The integration rejected initialization.",
      ),
    );
  }

  // Best-effort ack; some servers require it, none should fail the turn on it.
  try {
    await fetch(url, {
      method: "POST",
      headers: baseHeaders(headers, sessionId),
      signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
  } catch {
    // Ignore — the next request will surface any real connection problem.
  }

  return sessionId;
}

function withTimeout(): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

/** Connect to a server and list the tools it advertises. */
export async function mcpListTools(
  url: string,
  headers: McpHeader[],
): Promise<McpToolDef[]> {
  const { signal, done } = withTimeout();
  try {
    const sessionId = await handshake(url, headers, signal);
    const res = await fetch(url, {
      method: "POST",
      headers: baseHeaders(headers, sessionId),
      signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    if (!res.ok) {
      throw new McpFailureError(
        await diagnosticFromHttpResponse("tools/list", res),
      );
    }
    const msg = await readRpcMessage(res, 2);
    if (msg?.error) {
      throw new McpFailureError(
        diagnosticFromMcpPayload(
          "tools/list",
          msg.error,
          msg.error.message ?? "The integration rejected tools/list.",
        ),
      );
    }
    const tools = (msg?.result as { tools?: unknown[] } | undefined)?.tools;
    if (!Array.isArray(tools)) return [];
    const defs: McpToolDef[] = [];
    for (const raw of tools) {
      const t = raw as {
        name?: unknown;
        description?: unknown;
        inputSchema?: unknown;
      };
      if (typeof t.name !== "string" || !t.name) continue;
      defs.push({
        name: t.name,
        description:
          typeof t.description === "string" ? t.description : undefined,
        inputSchema:
          t.inputSchema && typeof t.inputSchema === "object"
            ? (t.inputSchema as Record<string, unknown>)
            : undefined,
      });
    }
    return defs;
  } catch (error) {
    throw new McpFailureError(
      withMcpOperation(
        diagnosticFromThrownError("tools/list", error),
        "tools/list",
      ),
    );
  } finally {
    done();
  }
}

/** Flatten an MCP `tools/call` result's content blocks into plain text. */
function flattenContent(result: unknown): string {
  const content = (result as { content?: unknown } | undefined)?.content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      const b = block as { type?: string; text?: string };
      if (b?.type === "text" && typeof b.text === "string") {
        parts.push(b.text);
      } else if (b?.type) {
        parts.push(`[${b.type} content omitted]`);
      }
    }
    if (parts.length) return parts.join("\n");
  }
  const structured = (result as { structuredContent?: unknown } | undefined)
    ?.structuredContent;
  if (structured !== undefined) {
    try {
      return JSON.stringify(structured);
    } catch {
      // fall through
    }
  }
  return "";
}

export type McpCallResult = {
  text: string;
  isError: boolean;
  /** The answer was longer than the caller's cap and has been clipped. */
  truncated: boolean;
  failure?: McpFailureDiagnostic;
};

/**
 * Connect to a server and invoke one tool by its real (un-namespaced) name.
 *
 * `maxChars` defaults to the model's budget, because the model is the usual
 * caller and a tool result it reads is prompt context. A data binding renders
 * into a component instead of a prompt, so it passes its own, much larger cap
 * — clipping a JSON body at 16k doesn't shorten it, it breaks it.
 */
export async function mcpCallTool(
  url: string,
  headers: McpHeader[],
  toolName: string,
  args: unknown,
  { maxChars = MAX_TOOL_RESULT_CHARS }: { maxChars?: number } = {},
): Promise<McpCallResult> {
  const { signal, done } = withTimeout();
  try {
    const sessionId = await handshake(url, headers, signal);
    const res = await fetch(url, {
      method: "POST",
      headers: baseHeaders(headers, sessionId),
      signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: toolName, arguments: args ?? {} },
      }),
    });
    if (!res.ok) {
      throw new McpFailureError(
        await diagnosticFromHttpResponse(toolName, res),
      );
    }
    const msg = await readRpcMessage(res, 3);
    if (msg?.error) {
      throw new McpFailureError(
        diagnosticFromMcpPayload(
          toolName,
          msg.error,
          msg.error.message ?? `The integration rejected ${toolName}.`,
        ),
      );
    }
    const result = msg?.result;
    const raw = flattenContent(result);
    const text = raw.slice(0, maxChars);
    const truncated = raw.length > maxChars;
    const isError = Boolean((result as { isError?: boolean })?.isError);
    if (isError) {
      const failure = diagnosticFromMcpPayload(toolName, result, text);
      return {
        text: formatMcpFailureDiagnostic(failure),
        isError: true,
        truncated: false,
        failure,
      };
    }
    return {
      text: text || "(the tool returned no content)",
      isError: false,
      truncated,
    };
  } catch (error) {
    throw new McpFailureError(
      withMcpOperation(
        diagnosticFromThrownError(toolName, error),
        toolName,
      ),
    );
  } finally {
    done();
  }
}

/** Slugify a server name so lookups tolerate spacing/casing differences. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "server"
  );
}

function compactDescription(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function compactSchemaDescriptions(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) compactSchemaDescriptions(item);
    return;
  }
  if (!node || typeof node !== "object") return;

  const obj = node as Record<string, unknown>;
  if (typeof obj.description === "string") {
    obj.description = compactDescription(
      obj.description,
      MAX_SCHEMA_DESCRIPTION_CHARS,
    );
  }
  for (const value of Object.values(obj)) {
    compactSchemaDescriptions(value);
  }
}

/**
 * One tool as a compact JSON line — shared by mcp_list_tools results and the
 * prompt preload for @mentioned integrations, so the model sees the same shape
 * either way. Schemas are shown as text, but they're still prompt context —
 * keep their embedded descriptions compact. Mutating a cached listing is fine:
 * compaction is idempotent and per-turn.
 */
function formatToolLine(def: McpToolDef): string {
  if (def.inputSchema) compactSchemaDescriptions(def.inputSchema);
  return JSON.stringify({
    name: def.name,
    ...(def.description
      ? {
          description: compactDescription(
            def.description,
            MAX_TOOL_DESCRIPTION_CHARS,
          ),
        }
      : {}),
    ...(def.inputSchema ? { inputSchema: def.inputSchema } : {}),
  });
}

/** The gateway tool that lists what an integration offers. */
export const MCP_LIST_TOOLS_NAME = "mcp_list_tools";
/** The gateway tool that runs one of those tools. */
export const MCP_CALL_TOOL_NAME = "mcp_call_tool";

/** Whether a tool name belongs to the MCP gateway (both tools share the prefix). */
export function isMcpToolName(name: string): boolean {
  return name.startsWith("mcp_");
}

/**
 * The model's gateway to the user's integrations. Instead of preloading every
 * server's full toolset into the request (40 tools' worth of schemas bloating
 * context whether or not any get used), the model is given just two tools:
 * `mcp_list_tools` to discover what an integration offers, and `mcp_call_tool`
 * to run one. The system prompt carries only each integration's name +
 * description, and `resolveServers` is invoked lazily on first use — so a turn
 * that never touches an integration pays zero MCP round trips.
 *
 * Because the gateway schemas are hand-written primitives, none of the strict
 * provider (Gemini) schema surgery the old per-tool injection needed applies:
 * real tool schemas only ever appear as *text* inside a listing result.
 */
export function createMcpGatewayTools({
  resolveServers,
  onToolsListed,
  onToolsListResult,
  onToolResult,
  onServerResult,
}: {
  /**
   * Resolves the user's enabled servers (decrypting headers / refreshing OAuth)
   * the first time the model reaches for an integration. Callers should
   * memoize; both gateway tools await it on every call.
   */
  resolveServers: () => Promise<McpServerConfig[]>;
  onToolsListed: (info: {
    server: string;
    toolCount: number;
  }) => Promise<void>;
  onToolsListResult: (info: {
    server: string;
    ok: boolean;
    error?: string;
  }) => Promise<void>;
  onToolResult: (info: {
    server: string;
    tool: string;
    ok: boolean;
    error?: string;
  }) => Promise<void>;
  /** Persist a connection outcome for the settings UI ("Connected" / lastError). */
  onServerResult?: (info: {
    id?: string;
    ok: boolean;
    error?: string;
    /** The server rejected our credential — the row needs a reconnect. */
    authExpired?: boolean;
  }) => Promise<void>;
}): {
  tools: Record<string, Tool>;
  preloadTools: (
    integration: string,
  ) => Promise<{ server: string; toolLines: string[] } | null>;
} {
  // One tools/list per server per turn: list → call → list again reuses it.
  // Failed listings are evicted so a retry actually retries.
  const listings = new Map<string, Promise<McpToolDef[]>>();

  const listServerTools = (server: McpServerConfig) => {
    const key = server.id ?? server.name;
    const existing = listings.get(key);
    if (existing) return existing;
    const listing = mcpListTools(server.url, server.headers);
    listings.set(key, listing);
    listing.catch(() => listings.delete(key));
    return listing;
  };

  const findServer = (servers: McpServerConfig[], name: string) => {
    const wanted = name.trim().toLowerCase();
    return (
      servers.find((s) => s.name.trim().toLowerCase() === wanted) ??
      servers.find((s) => slugify(s.name) === slugify(name))
    );
  };

  const connectedNames = (servers: McpServerConfig[]) =>
    servers.map((s) => `"${s.name}"`).join(", ");

  const listTool = tool({
    description:
      "List a connected integration's tools and input schemas before calling one.",
    inputSchema: jsonSchema<{ integration: string }>({
      type: "object",
      properties: {
        integration: {
          type: "string",
          description: "Exact listed integration name.",
        },
      },
      required: ["integration"],
    }),
    execute: async ({ integration }) => {
      let servers: McpServerConfig[];
      try {
        servers = await resolveServers();
      } catch {
        const error = formatMcpFailureDiagnostic(
          withMcpIntegration(
            createMcpFailureDiagnostic({
              operation: "tools/list",
              code: "INTEGRATION_RESOLUTION_FAILED",
              reason:
                "The user's integrations could not be reached right now.",
              retryGuidance:
                "Reconnect the integration, then retry; no provider action was sent.",
              requestWasSent: false,
            }),
            integration,
          ),
        );
        await onToolsListResult({
          server: integration,
          ok: false,
          error,
        });
        return error;
      }
      const server = findServer(servers, integration);
      if (!server) {
        const error = formatMcpFailureDiagnostic(
          withMcpIntegration(
            createMcpFailureDiagnostic({
              operation: "tools/list",
              code: "INTEGRATION_NOT_CONNECTED",
              reason:
                servers.length > 0
                  ? `No integration named "${integration}". Connected integrations: ${connectedNames(servers)}.`
                  : "The user has no integrations connected.",
              retryGuidance:
                "Choose a connected integration or connect it before retrying; no provider request was sent.",
              requestWasSent: false,
            }),
            integration,
          ),
        );
        await onToolsListResult({
          server: integration,
          ok: false,
          error,
        });
        return error;
      }
      try {
        const defs = await listServerTools(server);
        await onServerResult?.({ id: server.id, ok: true });
        await onToolsListed({ server: server.name, toolCount: defs.length });
        await onToolsListResult({ server: server.name, ok: true });
        if (defs.length === 0) {
          return `${server.name} advertises no tools right now.`;
        }
        const shown = defs.slice(0, MAX_MCP_TOOLS);
        const lines = shown.map(formatToolLine);
        const header = `${server.name} has ${defs.length} tool${defs.length === 1 ? "" : "s"}${
          shown.length < defs.length ? ` (showing ${shown.length})` : ""
        }. Run one with ${MCP_CALL_TOOL_NAME}.`;
        const body = [header, ...lines].join("\n");
        return body.length > MAX_TOOL_RESULT_CHARS
          ? `${body.slice(0, MAX_TOOL_RESULT_CHARS)}\n[listing truncated]`
          : body;
      } catch (error) {
        const diagnostic = withMcpIntegration(
          diagnosticFromThrownError("tools/list", error),
          server.name,
        );
        const message = formatMcpFailureDiagnostic(diagnostic);
        await onToolsListResult({
          server: server.name,
          ok: false,
          error: message,
        });
        await onServerResult?.({
          id: server.id,
          ok: false,
          error: message,
          authExpired: isAuthFailure(diagnostic),
        });
        return `Couldn't reach ${server.name}: ${message}`;
      }
    },
  });

  const callTool = tool({
    description: "Run a listed tool from a connected integration.",
    inputSchema: jsonSchema<{
      integration: string;
      tool: string;
      arguments?: string;
    }>({
      type: "object",
      properties: {
        integration: {
          type: "string",
          description: "Exact listed integration name.",
        },
        tool: {
          type: "string",
          description: "Listed tool name.",
        },
        arguments: {
          type: "string",
          description: "JSON object matching the listed schema. Omit if empty.",
        },
      },
      required: ["integration", "tool"],
    }),
    execute: async (input) => {
      const toolName = input.tool;
      // Every exit path reports a result so the chat's pending "Using a tool"
      // chip always settles into a finalized state instead of dangling.
      const fail = async (
        server: string,
        diagnostic: McpFailureDiagnostic,
      ) => {
        const enriched = withMcpIntegration(diagnostic, server);
        const error = formatMcpFailureDiagnostic(enriched);
        await onToolResult({ server, tool: toolName, ok: false, error });
        return error;
      };
      let servers: McpServerConfig[];
      try {
        servers = await resolveServers();
      } catch {
        return fail(
          input.integration,
          createMcpFailureDiagnostic({
            operation: toolName,
            code: "INTEGRATION_RESOLUTION_FAILED",
            reason: "The user's integrations could not be reached right now.",
            retryGuidance:
              "Reconnect the integration, then retry; no provider action was sent.",
            requestWasSent: false,
          }),
        );
      }
      const server = findServer(servers, input.integration);
      if (!server) {
        return fail(
          input.integration,
          createMcpFailureDiagnostic({
            operation: toolName,
            code: "INTEGRATION_NOT_CONNECTED",
            reason:
              servers.length > 0
                ? `No integration named "${input.integration}". Connected integrations: ${connectedNames(servers)}.`
                : "The user has no integrations connected.",
            retryGuidance:
              "Choose a connected integration or connect it before retrying; no provider action was sent.",
            requestWasSent: false,
          }),
        );
      }
      let args: unknown = {};
      const rawArgs = input.arguments?.trim();
      if (rawArgs) {
        try {
          args = JSON.parse(rawArgs);
        } catch {
          return fail(
            server.name,
            createMcpFailureDiagnostic({
              operation: toolName,
              code: "INVALID_ARGUMENTS",
              reason: "`arguments` must be a valid JSON-encoded object.",
              validationDetails: [
                {
                  field: "arguments",
                  message: "Expected a JSON-encoded object.",
                },
              ],
              retryGuidance:
                "Fix the JSON arguments, then retry; no provider action was sent.",
              requestWasSent: false,
            }),
          );
        }
      }
      try {
        const result = await mcpCallTool(
          server.url,
          server.headers,
          toolName,
          args,
        );
        if (result.failure && isAuthFailure(result.failure)) {
          await onServerResult?.({
            id: server.id,
            ok: false,
            error: result.text,
            authExpired: true,
          });
        }
        await onToolResult({
          server: server.name,
          tool: toolName,
          ok: !result.isError,
          ...(result.isError ? { error: result.text } : {}),
        });
        return result.text;
      } catch (error) {
        const diagnostic = withMcpIntegration(
          diagnosticFromThrownError(toolName, error),
          server.name,
        );
        const message = formatMcpFailureDiagnostic(diagnostic);
        await onServerResult?.({
          id: server.id,
          ok: false,
          error: message,
          authExpired: isAuthFailure(diagnostic),
        });
        return fail(server.name, diagnostic);
      }
    },
  });

  /**
   * Fetch one integration's tool listing ahead of the model call — used when
   * the user @mentioned it, so its toolset rides the system prompt and the
   * model can call mcp_call_tool without a discovery round trip. Shares the
   * per-turn listing cache with the gateway tools, so a follow-up
   * mcp_list_tools resolves instantly. Returns null when the server is
   * unknown, empty, or unreachable — callers fall back to lazy discovery.
   */
  const preloadTools = async (
    integration: string,
  ): Promise<{ server: string; toolLines: string[] } | null> => {
    let servers: McpServerConfig[];
    try {
      servers = await resolveServers();
    } catch {
      return null;
    }
    const server = findServer(servers, integration);
    if (!server) return null;
    try {
      const defs = await listServerTools(server);
      await onServerResult?.({ id: server.id, ok: true });
      await onToolsListed({ server: server.name, toolCount: defs.length });
      if (defs.length === 0) return null;
      return {
        server: server.name,
        toolLines: defs.slice(0, MAX_MCP_TOOLS).map(formatToolLine),
      };
    } catch (error) {
      const diagnostic = withMcpIntegration(
        diagnosticFromThrownError("tools/list", error),
        server.name,
      );
      const message = formatMcpFailureDiagnostic(diagnostic);
      await onServerResult?.({
        id: server.id,
        ok: false,
        error: message,
        authExpired: isAuthFailure(diagnostic),
      });
      return null;
    }
  };

  return {
    tools: {
      [MCP_LIST_TOOLS_NAME]: listTool,
      [MCP_CALL_TOOL_NAME]: callTool,
    },
    preloadTools,
  };
}
