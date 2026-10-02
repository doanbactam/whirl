import {
  IconBellFilled,
  IconCherryFilled,
  IconCloverFilled,
  IconDiamondFilled,
  IconGiftFilled,
} from "@tabler/icons-react";
import type { SlotSymbol as SymbolName } from "@whirl/backend/convex/slots/catalog";

const ICONS = {
  cherry: IconCherryFilled,
  bell: IconBellFilled,
  gem: IconDiamondFilled,
  clover: IconCloverFilled,
  gift: IconGiftFilled,
};

export function SlotSymbol({ symbol }: { symbol: SymbolName }) {
  const Icon = symbol === "seven" ? null : ICONS[symbol];
  return (
    <span
      className={`slot-symbol slot-symbol-${symbol}`}
      aria-label={symbol === "seven" ? "Seven" : symbol}
    >
      {Icon ? <Icon aria-hidden="true" /> : <span aria-hidden="true">7</span>}
    </span>
  );
}
