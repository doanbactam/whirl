// The store's fixed shelf list, shared by the classifier (storeCategorize.ts)
// and the store queries. Order here is display order on the browse page —
// clients mirror it (apps/v2/lib/store-categories.ts), so a new shelf means
// touching both files. "Everything else" is the catch-all and always renders
// last, including for rows the classifier hasn't reached yet.

export const STORE_CATEGORIES = [
  "Productivity",
  "Developer tools",
  "Data & analytics",
  "Docs & knowledge",
  "Communication",
  "Media & design",
  "Business & finance",
  "Search & web",
  "Everything else",
] as const;

export type StoreCategory = (typeof STORE_CATEGORIES)[number];

export function isStoreCategory(value: string): value is StoreCategory {
  return (STORE_CATEGORIES as readonly string[]).includes(value);
}
