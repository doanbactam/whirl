import type { Doc } from "@whirl/backend/convex/_generated/dataModel";
import { PERKS } from "@whirl/backend/convex/slots/catalog";

export function playLabel(play: Doc<"slotPlays">) {
  if (play.sku)
    return PERKS.find((perk) => perk.id === play.sku)?.name ?? "Perk";
  if (play.payout === 0) return "No match";
  if (play.payout === play.spent) return "Spin refunded";
  return `${play.payout.toLocaleString()} tokens`;
}
