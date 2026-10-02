// The budget behind /kirkify, and the arithmetic that spends it.
//
// Every Kirkify is a paid image edit, and the page hands them out to people
// who never signed in. So the free budget is bounded from several directions
// at once, and a request only goes through when EVERY bound it touches still
// has room:
//
//   anonymous pool   3 a day, counted against the IP and the device cookie.
//                    Clearing cookies leaves the IP count; changing networks
//                    leaves the device count.
//   account pool     5 more a day per signed-in free account, with a per-IP
//                    ceiling across accounts so one machine can't farm them.
//   paid             billed to the plan's usage like any other image, with a
//                    high per-day ceiling that only exists to stop a script.
//   global breakers  a site-wide daily ceiling on each free pool. When one
//                    trips, free Kirkifying pauses until midnight UTC; paid
//                    users are unaffected.
//   attempts         a ceiling on tries per IP, device and account, spent
//                    whether or not a picture came back.
//
// Days roll over at midnight UTC everywhere, on purpose: a fixed line is easy
// to explain and impossible to argue with.

import type { MutationCtx, QueryCtx } from "../_generated/server";

export const ANONYMOUS_DAILY_LIMIT = 3;
export const ACCOUNT_DAILY_LIMIT = 5;
export const ACCOUNT_POOL_PER_IP_LIMIT = 10;
export const PAID_DAILY_LIMIT = 60;
export const GLOBAL_ANONYMOUS_DAILY_CAP = 400;
export const GLOBAL_ACCOUNT_DAILY_CAP = 400;
/**
 * Attempts, not results. Every reservation counts one and nothing gives it
 * back, so a visitor whose photos keep getting refused (refunded, since no
 * picture was made) can't loop on the provider's input tokens all day.
 */
export const ATTEMPTS_PER_DAY = 24;
export const PAID_ATTEMPTS_PER_DAY = 120;

export type KirkifyPool = "anonymous" | "account" | "paid";

export type KirkifyRemaining = {
  anonymous: number;
  /** null when nobody is signed in. */
  account: number | null;
  total: number;
};

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
  );
}

export const quotaKeys = {
  ip: (ipHash: string) => `ip:${ipHash}`,
  device: (deviceId: string) => `device:${deviceId}`,
  user: (userId: string) => `user:${userId}`,
  ipAccounts: (ipHash: string) => `ipAccounts:${ipHash}`,
  paid: (userId: string) => `paid:${userId}`,
  globalAnonymous: "global:anonymous",
  globalAccount: "global:account",
  attemptsIp: (ipHash: string) => `attemptsIp:${ipHash}`,
  attemptsDevice: (deviceId: string) => `attemptsDevice:${deviceId}`,
  attemptsUser: (userId: string) => `attemptsUser:${userId}`,
} as const;

export type Visitor = {
  ipHash: string;
  deviceId: string;
  userId: string | null;
  /** On a paid plan with usage left to spend. */
  paid: boolean;
};

export type QuotaCounts = {
  ip: number;
  device: number;
  globalAnonymous: number;
  user: number;
  ipAccounts: number;
  globalAccount: number;
  paid: number;
  attemptsIp: number;
  attemptsDevice: number;
  attemptsUser: number;
};

export async function readCount(
  ctx: QueryCtx | MutationCtx,
  key: string,
  day: string,
): Promise<number> {
  const row = await ctx.db
    .query("kirkifyQuota")
    .withIndex("by_key_and_day", (q) => q.eq("key", key).eq("day", day))
    .unique();
  return row?.count ?? 0;
}

export async function readCounts(
  ctx: QueryCtx | MutationCtx,
  visitor: Pick<Visitor, "ipHash" | "deviceId" | "userId">,
  day: string,
): Promise<QuotaCounts> {
  const read = (key: string) => readCount(ctx, key, day);
  const [ip, device, globalAnonymous, globalAccount, attemptsIp, attemptsDevice] =
    await Promise.all([
      read(quotaKeys.ip(visitor.ipHash)),
      read(quotaKeys.device(visitor.deviceId)),
      read(quotaKeys.globalAnonymous),
      read(quotaKeys.globalAccount),
      read(quotaKeys.attemptsIp(visitor.ipHash)),
      read(quotaKeys.attemptsDevice(visitor.deviceId)),
    ]);
  const [user, ipAccounts, paid, attemptsUser] = visitor.userId
    ? await Promise.all([
        read(quotaKeys.user(visitor.userId)),
        read(quotaKeys.ipAccounts(visitor.ipHash)),
        read(quotaKeys.paid(visitor.userId)),
        read(quotaKeys.attemptsUser(visitor.userId)),
      ])
    : [0, 0, 0, 0];
  return {
    ip,
    device,
    globalAnonymous,
    user,
    ipAccounts,
    globalAccount,
    paid,
    attemptsIp,
    attemptsDevice,
    attemptsUser,
  };
}

/** The counters a reservation always bumps, refund or not. */
export function attemptKeys(
  visitor: Pick<Visitor, "ipHash" | "deviceId" | "userId">,
): string[] {
  return [
    quotaKeys.attemptsIp(visitor.ipHash),
    quotaKeys.attemptsDevice(visitor.deviceId),
    ...(visitor.userId ? [quotaKeys.attemptsUser(visitor.userId)] : []),
  ];
}

function overAttempted(counts: QuotaCounts, cap: number): boolean {
  return (
    counts.attemptsIp >= cap ||
    counts.attemptsDevice >= cap ||
    counts.attemptsUser >= cap
  );
}

/** Add `delta` to a counter, creating it on first touch. Never goes below zero. */
export async function bumpCount(
  ctx: MutationCtx,
  key: string,
  day: string,
  delta: number,
): Promise<void> {
  const row = await ctx.db
    .query("kirkifyQuota")
    .withIndex("by_key_and_day", (q) => q.eq("key", key).eq("day", day))
    .unique();
  if (!row) {
    await ctx.db.insert("kirkifyQuota", {
      key,
      day,
      count: Math.max(0, delta),
    });
    return;
  }
  await ctx.db.patch(row._id, { count: Math.max(0, row.count + delta) });
}

export type PoolDecision =
  | { ok: true; pool: KirkifyPool; keys: string[] }
  | { ok: false; reason: "exhausted" | "capacity" };

/**
 * Which pool pays for the next Kirkify, and which counters it bumps.
 *
 * Anonymous slots go first even for signed-in people: they're bound to the
 * IP and device, so spending them first leaves the account's five for when
 * the visitor is somewhere else. Pure, so the edge cases can be reasoned
 * about here rather than inside a transaction.
 */
export function decidePool(counts: QuotaCounts, visitor: Visitor): PoolDecision {
  const attemptCap = visitor.paid ? PAID_ATTEMPTS_PER_DAY : ATTEMPTS_PER_DAY;
  if (overAttempted(counts, attemptCap)) return { ok: false, reason: "exhausted" };

  if (visitor.paid && visitor.userId) {
    if (counts.paid >= PAID_DAILY_LIMIT) return { ok: false, reason: "exhausted" };
    return { ok: true, pool: "paid", keys: [quotaKeys.paid(visitor.userId)] };
  }

  const anonymousRoom =
    counts.ip < ANONYMOUS_DAILY_LIMIT && counts.device < ANONYMOUS_DAILY_LIMIT;
  const anonymousOpen = counts.globalAnonymous < GLOBAL_ANONYMOUS_DAILY_CAP;
  if (anonymousRoom && anonymousOpen) {
    return {
      ok: true,
      pool: "anonymous",
      keys: [
        quotaKeys.ip(visitor.ipHash),
        quotaKeys.device(visitor.deviceId),
        quotaKeys.globalAnonymous,
      ],
    };
  }

  if (visitor.userId) {
    const accountRoom =
      counts.user < ACCOUNT_DAILY_LIMIT &&
      counts.ipAccounts < ACCOUNT_POOL_PER_IP_LIMIT;
    if (!accountRoom) return { ok: false, reason: "exhausted" };
    if (counts.globalAccount >= GLOBAL_ACCOUNT_DAILY_CAP) {
      return { ok: false, reason: "capacity" };
    }
    return {
      ok: true,
      pool: "account",
      keys: [
        quotaKeys.user(visitor.userId),
        quotaKeys.ipAccounts(visitor.ipHash),
        quotaKeys.globalAccount,
      ],
    };
  }

  return { ok: false, reason: anonymousRoom ? "capacity" : "exhausted" };
}

/** What's left today, as the page shows it. */
export function summarizeRemaining(
  counts: QuotaCounts,
  visitor: Pick<Visitor, "userId">,
): KirkifyRemaining {
  if (overAttempted(counts, ATTEMPTS_PER_DAY)) {
    return { anonymous: 0, account: visitor.userId ? 0 : null, total: 0 };
  }
  const anonymous =
    counts.globalAnonymous >= GLOBAL_ANONYMOUS_DAILY_CAP
      ? 0
      : Math.max(
          0,
          ANONYMOUS_DAILY_LIMIT - Math.max(counts.ip, counts.device),
        );
  const account = visitor.userId
    ? counts.globalAccount >= GLOBAL_ACCOUNT_DAILY_CAP
      ? 0
      : Math.max(
          0,
          Math.min(
            ACCOUNT_DAILY_LIMIT - counts.user,
            ACCOUNT_POOL_PER_IP_LIMIT - counts.ipAccounts,
          ),
        )
    : null;
  return { anonymous, account, total: anonymous + (account ?? 0) };
}
