/* The contract between the Kirkify page and /api/kirkify. Mirrors the shapes
   convex/kirkify.ts returns, plus the two failures only the route can raise
   (a bot verdict, an unreachable server). */

export const KIRKIFY_ENDPOINT = "/api/kirkify";

export type KirkifyPool = "anonymous" | "account" | "paid";

export type KirkifyRemaining = {
  anonymous: number;
  /** null when nobody is signed in. */
  account: number | null;
  total: number;
};

export type KirkifyQuota = {
  signedIn: boolean;
  paid: boolean;
  remaining: KirkifyRemaining;
  /** Epoch ms of the next midnight UTC, when every counter starts over. */
  resetsAt: number;
};

export type KirkifyFailureCode =
  | "quota"
  | "capacity"
  | "invalid_image"
  | "provider"
  | "declined"
  | "config"
  | "bot"
  | "network";

export type KirkifySuccess = {
  ok: true;
  /** A data URL, ready for an <img>. */
  image: string;
  pool: KirkifyPool;
  remaining: KirkifyRemaining;
};

export type KirkifyFailure = {
  ok: false;
  code: KirkifyFailureCode;
  message: string;
  /** Whether the attempt spent a slot. */
  counted: boolean;
  remaining: KirkifyRemaining | null;
};

export type KirkifyResponse = KirkifySuccess | KirkifyFailure;
