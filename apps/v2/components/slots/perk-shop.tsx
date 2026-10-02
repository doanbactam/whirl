"use client";

import {
  IconCoinFilled,
  IconGiftFilled,
  IconMessageCircleFilled,
  IconPhotoFilled,
} from "@tabler/icons-react";
import {
  eligible,
  perkPrice,
  type Perk,
  type SlotPlan,
} from "@whirl/backend/convex/slots/catalog";
import type { Doc } from "@whirl/backend/convex/_generated/dataModel";
import { PlanBadge } from "@/components/plan-badge";

export function PerkIcon({ perk }: { perk: Perk }) {
  const Icon =
    perk.kind === "messages"
      ? IconMessageCircleFilled
      : perk.kind === "image"
        ? IconPhotoFilled
        : IconCoinFilled;
  return (
    <span className="slot-perk-icon" data-plan={Boolean(perk.plan)}>
      {perk.plan ? (
        <PlanBadge plan={perk.plan} className="h-5 w-auto" />
      ) : (
        <Icon size={23} aria-hidden="true" />
      )}
    </span>
  );
}

export function PerkShop({
  items,
  balance,
  plan,
  busy,
  onBuy,
}: {
  items: readonly (Perk & { remaining: number })[] | undefined;
  balance: number;
  plan: SlotPlan | null;
  busy: boolean;
  onBuy: (sku: string, price: number) => void;
}) {
  const visible = items?.filter(
    (perk) => plan !== null && eligible(perk, plan),
  );
  return (
    <section className="slot-shop" aria-labelledby="perk-shop-title">
      <div className="slot-section-heading">
        <h2 id="perk-shop-title">Perk shop</h2>
      </div>
      {!items || plan === null ? (
        <p className="slot-loading" role="status">
          Loading…
        </p>
      ) : (
        <div className="slot-shop-grid">
          {visible?.map((perk) => {
            const price = perkPrice(perk, plan);
            const soldOut = perk.remaining === 0;
            const reason = soldOut
              ? "Sold out"
              : balance < price
                ? "Not enough tokens"
                : null;
            return (
              <article
                key={perk.id}
                className={`slot-perk ${perk.plan === "platinum" ? "slot-perk-platinum" : ""}`}
                data-sold-out={soldOut}
              >
                <div className="slot-perk-top">
                  <PerkIcon perk={perk} />
                  <span className="slot-stock" data-rare={perk.remaining <= 10}>
                    {soldOut
                      ? "Sold out"
                      : `${perk.remaining.toLocaleString()} left`}
                  </span>
                </div>
                <h3>{perk.name}</h3>
                <div className="slot-perk-footer">
                  <button
                    onClick={() => onBuy(perk.id, price)}
                    disabled={busy || Boolean(reason)}
                    aria-label={`Buy ${perk.name} for ${price} tokens${reason ? ` — ${reason}` : ""}`}
                  >
                    <IconCoinFilled size={15} />
                    {price.toLocaleString()}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {plan !== null && visible?.length === 0 && (
        <p className="slot-loading">No perks available.</p>
      )}
      {visible?.some((perk) => perk.kind !== "credits") && (
        <details className="slot-shop-note">
          <summary>Perk terms</summary>
          <p>
            Passes start on activation. Plan passes require no active paid plan,
            include normal usage limits, and don’t renew. Monthly passes last
            one calendar month.
          </p>
          {plan === "free" && (
            <p>
              Extra messages expire at your next allowance reset. Image access
              lasts 24 hours with normal message limits.
            </p>
          )}
        </details>
      )}
    </section>
  );
}

export function PrizeTray({
  prizes,
  items,
  plan,
  busy,
  onActivate,
}: {
  prizes: Doc<"slotPrizes">[];
  items: readonly Perk[];
  plan: SlotPlan | null;
  busy: boolean;
  onActivate: (id: Doc<"slotPrizes">["_id"]) => void;
}) {
  const ready = prizes.filter((prize) => {
    const perk = items.find((item) => item.id === prize.sku);
    return (
      prize.status !== "active" && perk && plan !== null && eligible(perk, plan)
    );
  });
  const active = prizes.filter((prize) => prize.status === "active");
  return (
    <section className="slot-prize-tray" aria-labelledby="prize-tray-title">
      <div className="slot-section-heading">
        <h2 id="prize-tray-title">
          Prizes <span className="slot-count">{ready.length}</span>
        </h2>
      </div>
      {ready.length === 0 ? (
        <div className="slot-empty-tray">
          <IconGiftFilled size={24} />
          <p>No prizes yet.</p>
        </div>
      ) : (
        <div className="slot-prizes">
          {ready.map((prize) => {
            const perk = items.find((item) => item.id === prize.sku);
            if (!perk) return null;
            return (
              <article key={prize._id} className="slot-prize">
                <PerkIcon perk={perk} />
                <div>
                  <h3>{perk.name}</h3>
                  {prize.error && <p role="status">{prize.error}</p>}
                  {prize.status === "review" && (
                    <small>Prize ID: {prize._id}</small>
                  )}
                </div>
                <button
                  className="slot-small-button"
                  onClick={() => onActivate(prize._id)}
                  disabled={busy || prize.status !== "ready"}
                >
                  {prize.status === "activating"
                    ? "Activating…"
                    : prize.status === "review"
                      ? "Needs a check"
                      : "Activate"}
                </button>
              </article>
            );
          })}
        </div>
      )}
      {active.length > 0 && (
        <details className="slot-claimed">
          <summary>
            {active.length} activated {active.length === 1 ? "perk" : "perks"}
          </summary>
          {active.map((prize) => (
            <p key={prize._id}>
              <span>{items.find((item) => item.id === prize.sku)?.name}</span>
              <small>
                {prize.expiresAt
                  ? `Pass ends ${new Date(prize.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                  : "Added to your allowance"}
              </small>
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
