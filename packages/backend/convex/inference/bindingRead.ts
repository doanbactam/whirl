import { mcpCallTool, type McpServerConfig } from "./mcp";
import { findMcpServer } from "./mcpResolve";

/**
 * Running one *declared* integration read — the thing behind a react
 * artifact's `useWhirlData` and a live chart's data source.
 *
 * Both live surfaces name a binding by id and nothing else; the integration
 * and tool were fixed when the model wrote the thing. This module is the part
 * that turns that declaration into an actual call, and it is shared by every
 * caller (authoring-time validation in the tools, and the runtime action the
 * frame talks to) so none of them can drift on limits, parsing, or copy.
 */

/**
 * How much one binding read may carry back.
 *
 * Deliberately far above the gateway's per-call cap. A tool result the MODEL
 * reads is prompt context and has to stay small; a result a *component* reads
 * is a data set, and clipping it at 16k was silently cutting JSON in half —
 * which parses as nothing, so the page rendered empty with no explanation.
 */
export const BINDING_MAX_RESULT_CHARS = 100_000;

/** Keys listed when describing a response shape back to the model. */
const MAX_SHAPE_KEYS = 16;

export type BindingReadResult =
  | {
      ok: true;
      /** The raw response text, as cached. */
      text: string;
      /** Parsed when the integration answered JSON; the string otherwise. */
      data: unknown;
      /** One line describing what came back, for the model's benefit. */
      shape: string;
    }
  | {
      ok: false;
      error: string;
      /**
       * Why it failed, for callers that treat the two differently.
       * "not-connected" is a state of the account — it flips the instant the
       * user reconnects, so it must never be remembered — where a failed read
       * is a state of the data and can be cached briefly.
       */
      kind: "not-connected" | "read-failed";
    };

/* --- scopes + argument keys ------------------------------------------------ */

/** Cache/budget scope for a react artifact's reads. */
export const artifactScope = (htmlId: string) => `artifact:${htmlId}`;

/** Cache/budget scope for one live chart's read. */
export const chartScope = (messageId: string, phaseIndex: number) =>
  `chart:${messageId}:${phaseIndex}`;

/** Stable key for a set of resolved arguments. Order-insensitive by sorting. */
export function argsCacheKey(args: Record<string, unknown>): string {
  const entries = Object.entries(args).sort(([a], [b]) => (a < b ? -1 : 1));
  const json = JSON.stringify(entries);
  // djb2 — this only has to separate argument sets within one binding, so a
  // short non-cryptographic digest is the right amount of machinery.
  let hash = 5381;
  for (let i = 0; i < json.length; i += 1) {
    hash = ((hash << 5) + hash + json.charCodeAt(i)) | 0;
  }
  return `${(hash >>> 0).toString(36)}:${json.length}`;
}

/** A binding's declared `args` string as an object. Never throws. */
export function parseArgsObject(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Declared args are validated at authoring time, so this is only reachable
    // for extra args a refetch passed — treat as none.
  }
  return {};
}

/* --- parsing ---------------------------------------------------------------- */

/**
 * Turn an integration's answer into something a component can render.
 *
 * MCP tools answer with text that is usually, but not always, JSON. The
 * important case is the third one: text that *starts* like JSON and doesn't
 * parse. That used to be handed back as a plain string, so a page written
 * against an array of issues got a 100,000-character string instead and
 * rendered nothing at all. It is an error, and it says which error.
 */
export function parseBindingPayload(
  text: string,
  truncated = false,
): { ok: true; data: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, data: null };

  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!looksJson) {
    return truncated
      ? {
          ok: false,
          error: `This returned more text than one read can carry (over ${BINDING_MAX_RESULT_CHARS.toLocaleString("en-US")} characters). Ask for less of it.`,
        }
      : { ok: true, data: text };
  }

  try {
    return { ok: true, data: JSON.parse(trimmed) };
  } catch {
    return {
      ok: false,
      error: truncated
        ? `This returned more data than one read can carry (over ${BINDING_MAX_RESULT_CHARS.toLocaleString("en-US")} characters), so the response was cut off mid-JSON. Pass a limit, page size, or narrower filter in the binding's arguments.`
        : "This returned something that looked like JSON but couldn't be parsed.",
    };
  }
}

/**
 * One line describing what a read came back with — handed to the model at
 * authoring time so the component is written against the real response
 * instead of a guess at it.
 */
export function describeShape(data: unknown): string {
  if (data === null || data === undefined) return "empty";
  if (Array.isArray(data)) {
    if (data.length === 0) return "an empty array";
    const first = data[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      return `an array of ${data.length} objects with keys: ${keyList(first as Record<string, unknown>)}`;
    }
    return `an array of ${data.length} ${typeof first} values`;
  }
  if (typeof data === "object") {
    return `an object with keys: ${keyList(data as Record<string, unknown>)}`;
  }
  if (typeof data === "string") return `${data.length} characters of text`;
  return `a single ${typeof data} value`;
}

function keyList(value: Record<string, unknown>): string {
  const keys = Object.keys(value);
  const shown = keys.slice(0, MAX_SHAPE_KEYS).join(", ");
  return keys.length > MAX_SHAPE_KEYS
    ? `${shown}, …(${keys.length - MAX_SHAPE_KEYS} more)`
    : shown;
}

/* --- the read --------------------------------------------------------------- */

/**
 * Run one declared read against the user's already-resolved servers.
 *
 * Never throws: every caller here is either building a page for someone or
 * handing a correction back to the model, and both want a sentence rather than
 * a rejected promise.
 */
export async function readDeclaredSource({
  servers,
  integration,
  tool,
  args,
  maxChars = BINDING_MAX_RESULT_CHARS,
}: {
  servers: McpServerConfig[];
  integration: string;
  tool: string;
  /** The declared arguments, already merged with any extras. */
  args: Record<string, unknown>;
  maxChars?: number;
}): Promise<BindingReadResult> {
  const server = findMcpServer(servers, integration);
  if (!server) {
    return {
      ok: false,
      kind: "not-connected",
      error:
        servers.length > 0
          ? `"${integration}" isn't connected right now. Connected: ${servers.map((s) => s.name).join(", ")}.`
          : `"${integration}" isn't connected right now.`,
    };
  }

  let result;
  try {
    result = await mcpCallTool(server.url, server.headers, tool, args, {
      maxChars,
    });
  } catch (error) {
    return {
      ok: false,
      kind: "read-failed",
      error:
        error instanceof Error
          ? `${server.name} couldn't be read: ${error.message}`
          : `${server.name} couldn't be read.`,
    };
  }
  if (result.isError) {
    return { ok: false, kind: "read-failed", error: result.text };
  }

  const parsed = parseBindingPayload(result.text, result.truncated);
  if (!parsed.ok) {
    return {
      ok: false,
      kind: "read-failed",
      error: `${server.name}: ${parsed.error}`,
    };
  }

  return {
    ok: true,
    text: result.text,
    data: parsed.data,
    shape: describeShape(parsed.data),
  };
}
