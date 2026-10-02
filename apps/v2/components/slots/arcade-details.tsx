import { IconHistory, IconInfoCircle } from "@tabler/icons-react";
import type { Doc } from "@whirl/backend/convex/_generated/dataModel";
import { SlotSymbol } from "./slot-symbol";
import { playLabel } from "./play-label";

export function ArcadeDetails({ history }: { history: Doc<"slotPlays">[] }) {
  return (
    <div className="slot-details-grid">
      <section className="slot-paytable" aria-labelledby="paytable-title">
        <h2 id="paytable-title">
          <IconInfoCircle size={16} /> Payouts
        </h2>
        <div>
          <span>
            <SlotSymbol symbol="seven" />
            <SlotSymbol symbol="seven" />
            <SlotSymbol symbol="seven" />
          </span>
          <b>1,000</b>
          <small>0.1%</small>
        </div>
        <div>
          <span>
            <SlotSymbol symbol="gem" />
            <SlotSymbol symbol="gem" />
            <SlotSymbol symbol="gem" />
          </span>
          <b>150</b>
          <small>0.9%</small>
        </div>
        <div>
          <span>
            <SlotSymbol symbol="bell" />
            <SlotSymbol symbol="bell" />
            <SlotSymbol symbol="bell" />
          </span>
          <b>50</b>
          <small>3%</small>
        </div>
        <div>
          <span>
            <SlotSymbol symbol="cherry" />
            <SlotSymbol symbol="cherry" />
            <SlotSymbol symbol="cherry" />
          </span>
          <b>25</b>
          <small>10%</small>
        </div>
        <div>
          <span className="slot-pair-label">Any pair</span>
          <b>10</b>
          <small>22%</small>
        </div>
        <div>
          <span>
            <SlotSymbol symbol="gift" />
            <SlotSymbol symbol="gift" />
            <SlotSymbol symbol="gift" />
          </span>
          <b>A perk</b>
          <small>2%</small>
        </div>
        <details>
          <summary>Rules & odds</summary>
          <p>
            One centre line. Payouts include your stake. Each spin is
            independent. No match pays 0 tokens (62%). A gift spin selects an
            eligible perk from remaining stock, with rarer perks weighted less
            often. If none remain, it returns your 10 tokens. Platinum shares
            its two-pass lifetime stock between spins and the shop.
          </p>
          <p>
            Token payouts average 85.5% of the stake, before perk drops. Tokens
            can’t be bought, transferred, or exchanged for cash. You get 100
            starter tokens once per account, or per saved guest wallet. Guests
            receive single-use perk codes to redeem after signing up.
          </p>
        </details>
      </section>
      <section className="slot-history" aria-labelledby="slot-history-title">
        <h2 id="slot-history-title">
          <IconHistory size={16} /> Recent activity
        </h2>
        {history.length === 0 ? (
          <div className="slot-history-empty">No activity yet.</div>
        ) : (
          <ol>
            {history.slice(0, 6).map((play) => (
              <li key={play._id}>
                <span
                  className={`slot-history-dot ${play.sku || play.payout > play.spent ? "slot-history-win" : ""}`}
                />
                <div>
                  <strong>{playLabel(play)}</strong>
                  <small>
                    {play.type === "shop" ? "Shop" : "Spin"} ·{" "}
                    {new Date(play.createdAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </small>
                </div>
                <b data-positive={play.payout > play.spent}>
                  {play.payout - play.spent > 0 ? "+" : ""}
                  {play.payout - play.spent}
                </b>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
