"use client";

import { useState } from "react";
import Link from "next/link";
import { IconCopy, IconTicket } from "@tabler/icons-react";
import {
  eligible,
  PERKS,
  type SlotPlan,
} from "@whirl/backend/convex/slots/catalog";
import type { Doc } from "@whirl/backend/convex/_generated/dataModel";

export function GuestPrizeCodes({
  prizes,
  plan,
}: {
  prizes: Doc<"slotPrizes">[];
  plan: SlotPlan | null;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const visible = prizes.filter((prize) => {
    const perk = PERKS.find((perk) => perk.id === prize.sku);
    return perk && plan !== null && eligible(perk, plan);
  });
  if (!visible.length) return null;
  return (
    <section className="slot-guest-codes" aria-labelledby="guest-code-title">
      <h2 id="guest-code-title">
        <IconTicket size={20} /> Prize codes
      </h2>
      <p>
        Redeem in <Link href="/settings/account">Settings → Account</Link>. Keep
        codes private; each can be claimed once.
      </p>
      {visible.map((prize) => (
        <article key={prize._id}>
          <strong>{PERKS.find((perk) => perk.id === prize.sku)?.name}</strong>
          <div>
            <code>{prize.redemptionCode}</code>
            <button
              aria-label={`Copy code for ${PERKS.find((perk) => perk.id === prize.sku)?.name}`}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(prize.redemptionCode!);
                  setCopied(prize._id);
                  setCopyError(false);
                } catch {
                  setCopyError(true);
                }
              }}
            >
              <IconCopy size={14} />
              {copied === prize._id ? "Copied" : "Copy"}
            </button>
          </div>
        </article>
      ))}
      {copyError && (
        <p role="status">
          Copy wasn’t available. Select the code above and copy it manually.
        </p>
      )}
    </section>
  );
}
