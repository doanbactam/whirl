import type { Id } from "@whirl/backend/convex/_generated/dataModel";

// The console shares the main app's Convex deployment — this is the one place
// that imports the generated bindings, so every other file imports from
// `~/lib/backend` instead.
export { api } from "@whirl/backend/convex/_generated/api";
export type { Id };

export type IntegrationStatus = "pending" | "approved" | "denied";
export type AuthMode = "none" | "oauth" | "apiKey";

/** One input the installing user fills in (apiKey mode). */
export type AuthField = { key: string; label: string };

/** An MCP tool with the developer-written, user-facing status phrases:
 * `description` while it runs ("Searching your issues"), `completed` once
 * it's done ("Searched your issues"). `completed` is absent only on rows
 * saved before the field existed — the form requires it on save. */
export type IntegrationTool = {
  name: string;
  description: string;
  completed?: string;
};

/** Public shape returned by api.integrations.listMine. */
export type Integration = {
  id: Id<"integrations">;
  name: string;
  description?: string;
  author?: string;
  verified: boolean;
  logoUrl: string | null;
  bannerUrl: string | null;
  iconSvg?: string;
  mcpUrl?: string;
  authMode: AuthMode;
  authFields: AuthField[];
  authInstructions?: string;
  tools: IntegrationTool[];
  enabled: boolean;
  status: IntegrationStatus;
  reviewNote?: string;
  reviewedAt?: number;
  lastUsedAt?: number;
  createdAt: number;
  updatedAt: number;
};

/** What admins see in the approvals queue: the request plus who's asking. */
export type IntegrationRequest = Integration & {
  userId: string;
  requestedByName?: string;
  requestedByEmail?: string;
};

/** Public shape returned by api.skills.listMine. A skill is a pasted block
 * of instructions destined for the store's Skills tab — branding plus text,
 * no server or auth recipe. */
export type Skill = {
  id: Id<"skills">;
  name: string;
  description?: string;
  author?: string;
  verified: boolean;
  logoUrl: string | null;
  bannerUrl: string | null;
  iconSvg?: string;
  instructions: string;
  enabled: boolean;
  status: IntegrationStatus;
  reviewNote?: string;
  reviewedAt?: number;
  createdAt: number;
  updatedAt: number;
};

/** What admins see in the approvals queue: the request plus who's asking. */
export type SkillRequest = Skill & {
  userId: string;
  requestedByName?: string;
  requestedByEmail?: string;
};

/** A request to be let into Platinum (api.platinum.listInterest). Mirrors
 * InterestRow in convex/platinum.ts. */
export type PlatinumInterest = {
  id: Id<"platinumInterest">;
  userId: string;
  email: string;
  name: string | null;
  plan: "platinum" | "platinum_max";
  planName: string;
  status: "pending" | "approved" | "declined";
  checkoutUrl: string | null;
  emailedAt: number | null;
  emailError: string | null;
  createdAt: number;
};

/** One toolkit from Composio's catalog (api.composio.searchCatalog). */
export type ComposioToolkit = {
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

/** Internal billing key of a preset tier an admin can re-model. The label
 * mapping lives with the tiers themselves (pages/models/tier-data.ts):
 * Fast=Free, Basic=Fast, Max=Heavy. Auto is deliberately not overridable. */
export type ModelTierKey = "Fast" | "Basic" | "Max" | "Image";

/** What a model can do, auto-detected from OpenRouter at save time. */
export type ModelCapabilities = {
  vision: boolean;
  files: boolean;
  audio: boolean;
  reasoning: boolean;
  tools: boolean;
  imageOutput: boolean;
  contextLength: number;
};

/** Row shape returned by api.models.listAll. `tier` present means this row
 * overrides a preset tier instead of adding a catalog model. */
export type AiModel = {
  id: Id<"models">;
  tier?: ModelTierKey;
  slug: string;
  displayName: string;
  company: string;
  modelName: string;
  iconSvg?: string;
  capabilities: ModelCapabilities;
  enabled: boolean;
  /** Search-only in the picker: hidden while browsing, findable by query. */
  legacy: boolean;
  createdAt: number;
  updatedAt: number;
};

/** One provider icon shared by every catalog model with the same company. */
export type ModelProvider = {
  name: string;
  iconSvg?: string;
  modelCount: number;
};

/** api.models.detect result: OpenRouter's answer for a slug. */
export type DetectedModel = {
  slug: string;
  company: string;
  modelName: string;
  description: string;
  capabilities: ModelCapabilities;
};

/** A Composio extension already published to the store (api.composio.listAdded). */
export type ComposioExtension = {
  id: Id<"integrations">;
  slug: string;
  name: string;
  description?: string;
  logoUrl: string | null;
  toolCount: number;
  enabled: boolean;
  addedAt: number;
};
