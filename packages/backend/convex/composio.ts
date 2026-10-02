import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import { isAdminIdentity, requireAdmin } from "./admin";

// Admin-curated Composio extensions. Rather than exposing Composio's entire
// catalog to users, an admin hand-picks toolkits from the console's
// Extensions page. Adding one provisions the Composio side (a managed auth
// config + a single-toolkit MCP server) and drops a pre-approved listing into
// the regular `integrations` store table — from there it rides the exact same
// pipeline as any other integration: storefront, installs, and
// the MCP tool gateway. The only Composio-specific wrinkle lives at install
// time (see integrationStore.installInternal): each user's server URL gets a
// `user_id` param and our org API key rides along as an encrypted header.

const COMPOSIO_API_BASE = "https://backend.composio.dev";

// Default storefront-style view: the most-used toolkits. Searches sweep a
// bigger page and filter locally so we don't depend on the API's own search.
const CATALOG_PAGE_SIZE = 24;
const CATALOG_SEARCH_SWEEP = 500;

// Mirrors MAX_TOOLS in convex/integrations.ts and MAX_MCP_TOOLS at runtime.
const MAX_TOOLS_PER_EXTENSION = 40;

// Mirrors MAX_STORE_ENTRIES in convex/integrationStore.ts — the scan bound
// when collecting Composio-backed rows out of the approved listings.
const MAX_APPROVED_SCAN = 200;

const MAX_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 240;

// --- Composio HTTP client ----------------------------------------------------

function composioApiKey(): string {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) {
    throw new Error(
      "Composio isn't configured — set the COMPOSIO_API_KEY environment variable on the Convex deployment.",
    );
  }
  return key;
}

/** Minimal JSON client for Composio's v3 API. Throws with Composio's own
 * error message where it offers one, so admins see "why" not just "no". */
async function composioFetch(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<Record<string, unknown>> {
  const res = await fetch(`${COMPOSIO_API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "x-api-key": composioApiKey(),
      ...(init?.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Non-JSON body — fall through to the status check below.
  }
  if (!res.ok) {
    const detail =
      firstString(
        json.message,
        json.error,
        (json.error as Record<string, unknown> | undefined)?.message,
      ) ?? `HTTP ${res.status}`;
    throw new Error(`Composio said no: ${detail}`);
  }
  return json;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** v3 list endpoints wrap results as `{ items: [...] }`. */
function listItems(json: Record<string, unknown>): Record<string, unknown>[] {
  const items = json.items;
  return Array.isArray(items)
    ? items.filter(
        (i): i is Record<string, unknown> =>
          i !== null && typeof i === "object",
      )
    : [];
}

// --- Catalog parsing ----------------------------------------------------------

type CatalogToolkit = {
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  categories: string[];
  toolCount: number | null;
  noAuth: boolean;
  managedAuth: boolean;
  added: boolean;
};

function toCatalogToolkit(
  item: Record<string, unknown>,
  addedSlugs: Set<string>,
): CatalogToolkit | null {
  const slug = firstString(item.slug);
  if (!slug) return null;
  const meta = (item.meta ?? {}) as Record<string, unknown>;
  const categories = Array.isArray(meta.categories)
    ? meta.categories
        .map((c) =>
          typeof c === "string"
            ? c
            : firstString((c as Record<string, unknown>)?.name),
        )
        .filter((c): c is string => Boolean(c))
        .slice(0, 3)
    : [];
  const managedSchemes = item.composio_managed_auth_schemes;
  return {
    slug,
    name: firstString(item.name) ?? slug,
    description: firstString(meta.description, item.description) ?? "",
    logoUrl: firstString(meta.logo, item.logo) ?? null,
    categories,
    toolCount: typeof meta.tools_count === "number" ? meta.tools_count : null,
    noAuth: item.no_auth === true,
    managedAuth: Array.isArray(managedSchemes) && managedSchemes.length > 0,
    added: addedSlugs.has(slug),
  };
}

// --- Tool status phrases -------------------------------------------------------

// Whirl tool descriptions are the status lines chat shows while a tool runs
// ("Searching your issues") and after it finishes ("Searched your issues").
// Composio hands us imperative labels ("Search issues"), so we conjugate the
// leading verb when we recognize it and leave the label alone when we don't —
// a slightly stiff status line beats "Runing tool". Admins can polish any of
// these later through the regular integration edit form.
const VERB_FORMS: Record<string, [running: string, done: string]> = {
  add: ["Adding", "Added"],
  archive: ["Archiving", "Archived"],
  cancel: ["Cancelling", "Cancelled"],
  check: ["Checking", "Checked"],
  close: ["Closing", "Closed"],
  create: ["Creating", "Created"],
  delete: ["Deleting", "Deleted"],
  download: ["Downloading", "Downloaded"],
  edit: ["Editing", "Edited"],
  execute: ["Executing", "Executed"],
  fetch: ["Fetching", "Fetched"],
  find: ["Finding", "Found"],
  generate: ["Generating", "Generated"],
  get: ["Getting", "Got"],
  insert: ["Inserting", "Inserted"],
  invite: ["Inviting", "Invited"],
  list: ["Listing", "Listed"],
  mark: ["Marking", "Marked"],
  move: ["Moving", "Moved"],
  open: ["Opening", "Opened"],
  post: ["Posting", "Posted"],
  publish: ["Publishing", "Published"],
  read: ["Reading", "Read"],
  remove: ["Removing", "Removed"],
  reply: ["Replying", "Replied"],
  retrieve: ["Retrieving", "Retrieved"],
  run: ["Running", "Ran"],
  schedule: ["Scheduling", "Scheduled"],
  search: ["Searching", "Searched"],
  send: ["Sending", "Sent"],
  set: ["Setting", "Set"],
  share: ["Sharing", "Shared"],
  star: ["Starring", "Starred"],
  submit: ["Submitting", "Submitted"],
  sync: ["Syncing", "Synced"],
  update: ["Updating", "Updated"],
  upload: ["Uploading", "Uploaded"],
  write: ["Writing", "Wrote"],
};

/** "GMAIL_FETCH_EMAILS" (or "Fetch emails") -> "Fetch emails". */
function toolLabel(raw: string, toolkitSlug: string): string {
  let label = raw.trim();
  if (/^[A-Z0-9_]+$/.test(label)) {
    const prefix = `${toolkitSlug.toUpperCase()}_`;
    if (label.startsWith(prefix)) label = label.slice(prefix.length);
    label = label.split("_").join(" ").toLowerCase();
  }
  label = label.replace(/\s+/g, " ").trim();
  if (!label) return raw.trim();
  return label[0].toUpperCase() + label.slice(1);
}

function toolPhrases(label: string): { running: string; done: string } {
  const [head, ...rest] = label.split(" ");
  const forms = VERB_FORMS[head.toLowerCase()];
  if (!forms || rest.length === 0) return { running: label, done: label };
  const tail = rest.join(" ");
  return { running: `${forms[0]} ${tail}`, done: `${forms[1]} ${tail}` };
}

// --- Connected accounts (install-time auth) ------------------------------------

export type ComposioConnectLink = {
  connectedAccountId: string;
  redirectUrl: string;
};

/**
 * Mint a hosted auth link for one user + auth config — Composio's link flow.
 * The user completes OAuth (or key entry) on Composio's hosted page; the
 * connected account flips to ACTIVE when they're done. Called from
 * integrationStore's install/connect actions.
 */
export async function createComposioConnectLink(
  authConfigId: string,
  userId: string,
  callbackUrl?: string,
): Promise<ComposioConnectLink> {
  const json = await composioFetch(`/api/v3/connected_accounts/link`, {
    method: "POST",
    body: {
      auth_config_id: authConfigId,
      user_id: userId,
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    },
  });
  const connectedAccountId = firstString(json.connected_account_id, json.id);
  const redirectUrl = firstString(json.redirect_url, json.redirect_uri);
  if (!connectedAccountId || !redirectUrl) {
    throw new Error("Composio didn't return a connect link.");
  }
  return { connectedAccountId, redirectUrl };
}

/** True once Composio reports the connected account usable. */
export async function isComposioAccountActive(
  connectedAccountId: string,
): Promise<boolean> {
  const json = await composioFetch(
    `/api/v3/connected_accounts/${encodeURIComponent(connectedAccountId)}`,
  );
  return firstString(json.status)?.toUpperCase() === "ACTIVE";
}

// --- Queries -------------------------------------------------------------------

/** Approved store listings that came from Composio, alphabetical. */
async function addedComposioRows(ctx: QueryCtx): Promise<Doc<"integrations">[]> {
  const rows = await ctx.db
    .query("integrations")
    .withIndex("by_status", (q) => q.eq("status", "approved"))
    .take(MAX_APPROVED_SCAN);
  return rows
    .filter((row) => row.composio)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The console's list of added Composio extensions. Returns [] for non-admins
 * instead of throwing — same manner as integrations.listPendingRequests, so
 * the page can subscribe before the client-side admin gate settles.
 */
export const listAdded = query({
  args: {},
  handler: async (ctx) => {
    if (!(await isAdminIdentity(ctx))) return [];
    const rows = await addedComposioRows(ctx);
    return rows.map((row) => ({
      id: row._id,
      slug: row.composio!.slug,
      name: row.name,
      description: row.description,
      logoUrl: row.logoUrl ?? null,
      toolCount: row.tools?.length ?? 0,
      enabled: row.enabled,
      addedAt: row.createdAt,
    }));
  },
});

export const listAddedSlugs = internalQuery({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const rows = await addedComposioRows(ctx);
    return rows.map((row) => row.composio!.slug);
  },
});

export const getListing = internalQuery({
  args: { id: v.id("integrations") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

// --- Catalog search ---------------------------------------------------------

/**
 * Browse Composio's toolkit catalog. No search => the most-used toolkits, a
 * storefront default. With a search we pull a much larger page and match
 * locally on slug/name/category, so results don't depend on how (or whether)
 * Composio's own search filter behaves.
 */
export const searchCatalog = action({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, args): Promise<CatalogToolkit[]> => {
    await requireAdmin(ctx);
    const search = args.search?.trim().toLowerCase() ?? "";

    const params = new URLSearchParams({ sort_by: "usage" });
    params.set(
      "limit",
      String(search ? CATALOG_SEARCH_SWEEP : CATALOG_PAGE_SIZE),
    );
    if (search) params.set("search", search);
    const json = await composioFetch(`/api/v3/toolkits?${params}`);

    const addedSlugs = new Set<string>(
      await ctx.runQuery(internal.composio.listAddedSlugs, {}),
    );
    const toolkits = listItems(json)
      .map((item) => toCatalogToolkit(item, addedSlugs))
      .filter((t): t is CatalogToolkit => t !== null);
    if (!search) return toolkits.slice(0, CATALOG_PAGE_SIZE);

    const matches = (t: CatalogToolkit) =>
      t.slug.toLowerCase().includes(search) ||
      t.name.toLowerCase().includes(search) ||
      t.categories.some((c) => c.toLowerCase().includes(search));
    return toolkits.filter(matches).slice(0, CATALOG_PAGE_SIZE);
  },
});

// --- Add / remove -------------------------------------------------------------

/**
 * Which of our allowed tools an MCP-server-creation error rejected by name.
 * Composio's message reads like `Invalid tools provided for MCP server
 * "whirl gmail": GMAIL_REMOVE_LABEL. These tools do not belong to ...` — we
 * pull every SCREAMING_SNAKE token out of it and keep only ones we actually
 * sent, so unrelated words in the message can't eject legitimate tools.
 */
function rejectedToolSlugs(error: unknown, allowed: string[]): Set<string> {
  if (!(error instanceof Error) || !/invalid tools/i.test(error.message)) {
    return new Set();
  }
  const allowedSet = new Set(allowed);
  const mentioned = error.message.match(/[A-Z][A-Z0-9_]{2,}/g) ?? [];
  return new Set(mentioned.filter((slug) => allowedSet.has(slug)));
}

/** Composio MCP server names allow 4-30 chars: alphanumeric, space, hyphen. */
function composioServerName(slug: string): string {
  const cleaned = `whirl ${slug}`
    .replace(/[^a-zA-Z0-9 -]/g, "-")
    .slice(0, 30)
    .trim();
  return cleaned.length >= 4 ? cleaned : `whirl srv`;
}

/**
 * Add one Composio toolkit to the integration store. Provisions the Composio
 * side first (managed auth config, then a single-toolkit MCP server), and
 * only then writes the listing — with best-effort remote cleanup if a later
 * step trips, so a failed add doesn't strand half a setup in Composio.
 */
export const addToolkit = action({
  args: { slug: v.string() },
  handler: async (ctx, args): Promise<{ id: Id<"integrations"> }> => {
    await requireAdmin(ctx);
    const slug = args.slug.trim().toLowerCase();
    if (!slug) throw new Error("Pick a toolkit first.");

    const addedSlugs: string[] = await ctx.runQuery(
      internal.composio.listAddedSlugs,
      {},
    );
    if (addedSlugs.includes(slug)) {
      throw new Error("That toolkit is already in the store.");
    }

    // Toolkit metadata for the listing's branding.
    const toolkit = await composioFetch(
      `/api/v3/toolkits/${encodeURIComponent(slug)}`,
    );
    const meta = (toolkit.meta ?? {}) as Record<string, unknown>;
    const name = (firstString(toolkit.name) ?? slug).slice(0, MAX_NAME_LENGTH);
    const description = firstString(meta.description, toolkit.description)
      ?.slice(0, MAX_DESCRIPTION_LENGTH);
    const logoUrl = firstString(meta.logo, toolkit.logo);
    const noAuth = toolkit.no_auth === true;

    // The toolkit's tools become the listing's status phrases, and cap what
    // the MCP server may expose (Whirl's runtime reads at most 40 anyway).
    const toolsJson = await composioFetch(
      `/api/v3/tools?toolkit_slug=${encodeURIComponent(slug)}&limit=${MAX_TOOLS_PER_EXTENSION}`,
    );
    const tools = listItems(toolsJson)
      .map((item) => {
        const toolSlug = firstString(item.slug);
        if (!toolSlug) return null;
        const label = toolLabel(
          firstString(item.display_name, item.name) ?? toolSlug,
          slug,
        );
        const phrases = toolPhrases(label);
        return {
          name: toolSlug,
          description: phrases.running,
          completed: phrases.done,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .slice(0, MAX_TOOLS_PER_EXTENSION);

    // Composio-managed auth: Composio's own OAuth app / key handling. Where a
    // toolkit doesn't offer it, Composio errors here and the admin sees why.
    const authJson = await composioFetch(`/api/v3/auth_configs`, {
      method: "POST",
      body: {
        toolkit: { slug },
        auth_config: { type: "use_composio_managed_auth" },
      },
    });
    const authConfigId = firstString(
      (authJson.auth_config as Record<string, unknown> | undefined)?.id,
      authJson.id,
    );
    if (!authConfigId) {
      throw new Error("Composio didn't return an auth config id.");
    }

    let mcpServerId: string | undefined;
    try {
      // Composio's tools listing and its MCP-server validator can disagree
      // about which tools belong to a toolkit (tools are versioned, and the
      // listing includes deprecated ones). When creation rejects tools by
      // name, drop exactly those and try again rather than failing the add.
      let allowedTools = tools.map((t) => t.name);
      let serverJson: Record<string, unknown> | undefined;
      let retries = 0;
      while (serverJson === undefined) {
        try {
          serverJson = await composioFetch(`/api/v3/mcp/servers`, {
            method: "POST",
            body: {
              name: composioServerName(slug),
              auth_config_ids: [authConfigId],
              ...(allowedTools.length > 0
                ? { allowed_tools: allowedTools }
                : {}),
            },
          });
        } catch (error) {
          const rejected =
            retries < 3
              ? rejectedToolSlugs(error, allowedTools)
              : new Set<string>();
          if (rejected.size === 0) throw error;
          retries += 1;
          allowedTools = allowedTools.filter((name) => !rejected.has(name));
        }
      }
      // Keep the listing's status phrases honest about what survived. If
      // every tool got rejected the server ends up unrestricted, so the full
      // scanned list is the closest description we have.
      const allowedSet = new Set(allowedTools);
      const listedTools =
        allowedTools.length > 0
          ? tools.filter((t) => allowedSet.has(t.name))
          : tools;

      mcpServerId = firstString(serverJson.id, serverJson.uuid);
      if (!mcpServerId) {
        throw new Error("Composio didn't return an MCP server id.");
      }

      // Prefer the URL Composio hands back; fall back to fetching the server,
      // then to the documented URL shape as a last resort.
      let mcpUrl = firstString(serverJson.mcp_url, serverJson.url);
      if (!mcpUrl) {
        const detail = await composioFetch(
          `/api/v3/mcp/servers/${encodeURIComponent(mcpServerId)}`,
        );
        mcpUrl = firstString(detail.mcp_url, detail.url);
      }
      if (!mcpUrl) {
        mcpUrl = `${COMPOSIO_API_BASE}/v3/mcp/${mcpServerId}/mcp`;
      }

      const result: { id: Id<"integrations"> } = await ctx.runMutation(
        internal.composio.insertListing,
        {
          slug,
          name,
          description,
          logoUrl,
          mcpUrl,
          tools: listedTools,
          authConfigId,
          mcpServerId,
          noAuth,
        },
      );
      return result;
    } catch (error) {
      // Roll back the Composio side so a failed add leaves nothing behind.
      if (mcpServerId) {
        await composioFetch(
          `/api/v3/mcp/servers/${encodeURIComponent(mcpServerId)}`,
          { method: "DELETE" },
        ).catch(() => {});
      }
      await composioFetch(
        `/api/v3/auth_configs/${encodeURIComponent(authConfigId)}`,
        { method: "DELETE" },
      ).catch(() => {});
      throw error;
    }
  },
});

export const insertListing = internalMutation({
  args: {
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    mcpUrl: v.string(),
    tools: v.array(
      v.object({
        name: v.string(),
        description: v.string(),
        completed: v.string(),
      }),
    ),
    authConfigId: v.string(),
    mcpServerId: v.string(),
    noAuth: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ id: Id<"integrations"> }> => {
    await requireAdmin(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const now = Date.now();
    const id = await ctx.db.insert("integrations", {
      userId: identity!.subject,
      name: args.name,
      description: args.description,
      author: "Composio",
      verified: true,
      logoUrl: args.logoUrl,
      mcpUrl: args.mcpUrl,
      // End-user auth runs through Composio's hosted connect flow at install
      // time (see integrationStore.startComposioConnect), so the listing
      // itself collects nothing up front.
      authMode: "none",
      tools: args.tools,
      // Drafts first: a fresh extension stays off the storefront until the
      // admin flips it live from the Extensions page, so there's room to
      // polish names, descriptions, and tool phrases before anyone sees it.
      enabled: false,
      // Admin-added => pre-approved; no reason to queue behind yourself.
      status: "approved",
      requestedByName: identity!.name,
      requestedByEmail: identity!.email,
      reviewedBy: identity!.subject,
      reviewedAt: now,
      composio: {
        slug: args.slug,
        authConfigId: args.authConfigId,
        mcpServerId: args.mcpServerId,
        noAuth: args.noAuth,
      },
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  },
});

/**
 * Remove a Composio extension: best-effort teardown of the Composio-side
 * server + auth config, then the listing itself. Existing user installs keep
 * their (now dead) server rows, exactly like deleting any other listing —
 * users tidy those from their own integrations page.
 */
export const removeToolkit = action({
  args: { id: v.id("integrations") },
  handler: async (ctx, args): Promise<null> => {
    await requireAdmin(ctx);
    const row: Doc<"integrations"> | null = await ctx.runQuery(
      internal.composio.getListing,
      { id: args.id },
    );
    if (!row?.composio) {
      throw new Error("That listing isn't a Composio extension.");
    }
    await composioFetch(
      `/api/v3/mcp/servers/${encodeURIComponent(row.composio.mcpServerId)}`,
      { method: "DELETE" },
    ).catch(() => {});
    await composioFetch(
      `/api/v3/auth_configs/${encodeURIComponent(row.composio.authConfigId)}`,
      { method: "DELETE" },
    ).catch(() => {});
    await ctx.runMutation(internal.composio.removeListing, { id: args.id });
    return null;
  },
});

export const removeListing = internalMutation({
  args: { id: v.id("integrations") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    if (row.logoId) await ctx.storage.delete(row.logoId);
    if (row.bannerId) await ctx.storage.delete(row.bannerId);
    await ctx.db.delete(args.id);
    return null;
  },
});
