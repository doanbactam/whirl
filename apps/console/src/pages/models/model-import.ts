import { parseJsonc } from "~/lib/jsonc";

export type ModelImportRow = {
  slug: string;
  displayName?: string;
  company?: string;
  modelName?: string;
};

/**
 * Accept a top-level array or `{ "models": [...] }`. Entries may be plain
 * OpenRouter slugs or objects with optional display-name overrides.
 */
export function parseModelImport(text: string): ModelImportRow[] {
  const parsed = parseJsonc(text);
  const source =
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "models" in parsed
      ? (parsed as { models?: unknown }).models
      : parsed;
  if (!Array.isArray(source)) {
    throw new Error('Expected an array, or an object with a "models" array.');
  }
  if (source.length === 0) throw new Error("That file has no models.");
  if (source.length > 50) throw new Error("Import at most 50 models at a time.");

  const rows = source.map((entry, index): ModelImportRow => {
    if (typeof entry === "string") {
      const slug = entry.trim();
      if (!slug) throw new Error(`Model ${index + 1} has an empty slug.`);
      return { slug };
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Model ${index + 1} must be a slug or an object.`);
    }
    const row = entry as Record<string, unknown>;
    const rawSlug = row.slug ?? row.id;
    if (typeof rawSlug !== "string" || !rawSlug.trim()) {
      throw new Error(`Model ${index + 1} needs a slug.`);
    }
    const optional = (key: string): string | undefined => {
      const value = row[key];
      if (value === undefined || value === null || value === "") return undefined;
      if (typeof value !== "string") {
        throw new Error(`Model ${index + 1}'s ${key} must be text.`);
      }
      return value.trim() || undefined;
    };
    const displayName = optional("displayName");
    const company = optional("company") ?? optional("provider");
    const modelName = optional("modelName");
    return {
      slug: rawSlug.trim(),
      ...(displayName ? { displayName } : {}),
      ...(company ? { company } : {}),
      ...(modelName ? { modelName } : {}),
    };
  });

  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.slug)) {
      throw new Error(`"${row.slug}" appears more than once in the file.`);
    }
    seen.add(row.slug);
  }
  return rows;
}
