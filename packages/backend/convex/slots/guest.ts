import { ConvexError } from "convex/values";

/** A 256-bit browser capability. Never put it in URLs, analytics or logs. */
export function guestOwner(key: string | undefined) {
  if (!key || !/^[a-f0-9]{64}$/.test(key))
    throw new ConvexError(
      "Your guest wallet could not be opened. Refresh the arcade and try again.",
    );
  return `guest:${key}`;
}

export function newRedemptionCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `WHIRL-${hex.match(/.{4}/g)!.join("-")}`;
}

export function normalizeRedemptionCode(code: string) {
  const normalized = code.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^WHIRL[A-F0-9]{24}$/.test(normalized))
    throw new ConvexError(
      "Enter the complete code from your arcade prize tray.",
    );
  return `WHIRL-${normalized.slice(5).match(/.{4}/g)!.join("-")}`;
}
