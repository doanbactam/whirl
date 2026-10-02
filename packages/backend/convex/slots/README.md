# Token Arcade

The page is `/about/slots`, linked from the marketing Resources navigation.
Account settings (`/settings/account`) contains the code redemption form and
controls to activate saved rewards.

## Economy

`catalog.ts` defines prices, lifetime stock, eligibility, grant durations and drop
weights. Wallets begin with 100 tokens. Spins cost 10 tokens, have a three-second
server cooldown, and use the outcome distribution shown on the page. Token
payouts return 85.5% on average, excluding perks. Tokens cannot be purchased.

`slotStock` counts reservations, not activations. Both shop purchases and drops
reserve from this same stock atomically, so Platinum can be awarded only twice.
Redeeming a guest code transfers the original prize and never consumes more stock.
Changing a catalog stock value changes the lifetime ceiling; there is no daily
restock or stock reset.

Signed-in wallet ownership uses the authenticated token identifier. Existing
Autumn billing customers continue to use the Clerk subject, matching the rest of
Whirl. Guests get a 256-bit browser capability stored in localStorage. Clearing
browser storage loses that guest wallet; saved perk codes remain usable. Guest
wallets are browser identities, not verified people, so a new browser identity
can receive a new starter balance. Guest perks use free-tier eligibility.

## Rewards

- Extra messages add 25 to the existing Autumn `messages` balance and follow its
  reset period. Extra usage adds $2 to `extra_usage`. Existing buckets use an
  idempotent negative usage event; an absent bucket is created through Autumn.
- Image passes grant 24 hours of the preset Image model, checked in the picker
  and on the inference server. Normal free message, upload and overload limits
  still apply. Passes stack and expiry is enforced even before scheduled cleanup.
- Plan passes use the existing Autumn plan with a free custom price, explicit
  end time, no billing changes, and no checkout redirect. They preserve the plan's
  ordinary usage limits. Activation waits until any existing paid plan ends;
  winning or buying a pass does not replace a subscription. Monthly passes end
  on the corresponding date of the next month, clamped to its last day.
- Guest rewards carry a server-generated 96-bit redemption code. A signed-in
  user claims it once in Settings → Account. Claiming saves the perk; activation
  is separate so a pass starts when the user chooses. Codes are bearer secrets.

## Failure handling

Token spending, receipt creation and stock reservations are one Convex mutation.
Request IDs protect retries; monotonic wallet revisions also reject replays after
the bounded, 20-entry receipt history has been trimmed.

Activations are scheduled durably, with one in flight per wallet and a two-minute
watchdog. Retryable failures leave prizes `ready`. Non-idempotent grants (plans or
the first balance in a new bucket) with an uncertain provider result become
`review`, including if the worker stops before recording its receipt.

For a prize in `review`, inspect its saved customer ID, SKU, start/end timestamps
and the corresponding Autumn customer before calling the admin-only
`slotRewards:reconcile` mutation. Set `delivered: true` only if the reward was
delivered, or `false` only after verifying it was not. This releases the prize for
an intentional retry without guessing whether the previous grant succeeded.

## Validation and rollout

Run `bun run test:slots` and `bun run typecheck` in `packages/backend`. Tests use
isolated `convex-test` databases and mocked billing, including concurrent stock
and code claims, eligibility, payouts, expiry and failed grant recovery.

Deploy the Convex schema/functions with the frontend through the normal release
process. The existing `AUTUMN_SECRET_KEY` and Mini/Turbo/Mega/Platinum product IDs
are reused. The pinned SDK lacks plan end-date support, so plan fulfillment uses
the documented `/v1/billing.attach` endpoint directly. Validate one timed pass
against an Autumn sandbox before production rollout; automated tests do not
create real billing subscriptions.
