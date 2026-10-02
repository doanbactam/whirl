// User-facing display names for each model tier. The internal keys
// ("Fast", "Basic", …) are persisted in the DB and wired into billing gates,
// so we never rename them — we just relabel them here for the UI. Keep this in
// sync with MODEL_IDS in convex/inference/billing.ts.
//
// Yes, the key "Fast" is labeled "Free" and the key "Basic" is labeled "Fast".
// The keys are history; the labels are the truth. Free is the free tier's
// model; Fast and Heavy are the paid lineup. The retired "Pro" key only
// survives in old DB rows (modelLabel falls back to the raw key for those).
export type ModelKey = "Auto" | "Fast" | "Basic" | "Max" | "Image";

export const MODEL_LABELS: Record<ModelKey, string> = {
  Auto: "Auto",
  Fast: "Free",
  Basic: "Fast",
  Max: "Heavy",
  Image: "Image",
};

// Non-model background jobs that also bill usage and appear in the activity
// table. Not real tiers, so they live outside MODEL_LABELS.
const UTILITY_LABELS: Record<string, string> = {
  Index: "Memory sync",
};

/** The label shown to users for a model key (falls back to the raw key). */
export function modelLabel(key: string): string {
  return MODEL_LABELS[key as ModelKey] ?? UTILITY_LABELS[key] ?? key;
}
