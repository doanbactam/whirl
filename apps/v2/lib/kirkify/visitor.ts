/* Who is asking, as far as the daily budget is concerned. Server only.

   Two handles per visitor: the connection's IP, hashed with the shared
   secret so no address is ever stored, and a device id in an httpOnly
   cookie. Both count, and both must have room. Clearing the cookie only
   mints a new device id; the IP count stays. Switching networks only
   changes the IP; the device count stays. */

import { createHash, randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export const DEVICE_COOKIE = "kirkify_device";
/* Chrome caps cookie lifetimes at 400 days. */
const DEVICE_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/**
 * The connecting address. Vercel writes x-real-ip and x-forwarded-for from
 * the connection and overwrites anything the client sent, so neither can
 * be spoofed past the proxy. Locally there's neither and every request
 * shares one bucket, which is what you'd want while testing the limits.
 */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

/**
 * The bucket an address counts in. IPv4 is itself. IPv6 is its /64: a
 * home connection gets a whole /64 and privacy extensions rotate the
 * bottom half every few hours, so counting full addresses would hand a
 * fresh three to anyone willing to wait.
 */
export function ipBucket(ip: string): string {
  const bare = ip.replace(/^\[|\]$/g, "").split("%")[0]!;
  if (!bare.includes(":")) return bare;

  const mapped = bare.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1]!;

  const [head = "", tail = ""] = bare.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = Math.max(0, 8 - headParts.length - tailParts.length);
  const full = [...headParts, ...Array<string>(missing).fill("0"), ...tailParts];
  const prefix = full
    .slice(0, 4)
    .map((part) => part.toLowerCase().padStart(4, "0"))
    .join(":");
  return `${prefix}::/64`;
}

export function hashIp(ip: string, salt: string): string {
  return createHash("sha256")
    .update(`${salt}:${ipBucket(ip)}`)
    .digest("hex")
    .slice(0, 32);
}

export function readDeviceId(request: NextRequest): string {
  const given = request.cookies.get(DEVICE_COOKIE)?.value;
  return given && UUID.test(given) ? given.toLowerCase() : randomUUID();
}

/** Set (or refresh) the device cookie on the way out. */
export function keepDeviceCookie(response: NextResponse, id: string): void {
  response.cookies.set(DEVICE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/kirkify",
    maxAge: DEVICE_COOKIE_MAX_AGE_S,
  });
}
