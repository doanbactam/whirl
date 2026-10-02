import { makeFunctionReference } from "convex/server";
import { useQuery } from "convex/react";

/**
 * Server-overload state, mirroring the `serverLoad:getServerLoad` Convex query.
 * Vague by design — a severity `level` and the tightened free-message `cap`,
 * never the underlying cost. Drives the under-composer "servers under extra
 * load" notice. Only free users are ever throttled; the UI gates on that.
 */
export type ServerLoad = {
  /** 0 = normal load; higher = more throttled. */
  level: number;
  /** Tightened daily free-message cap while overloaded, else null. */
  cap: number | null;
  updatedAt: number | null;
};

const serverLoadRef = makeFunctionReference<"query">("serverLoad:getServerLoad");

/** Subscribes to the current server-overload state. `undefined` while loading. */
export function useServerLoad(): ServerLoad | undefined {
  return useQuery(serverLoadRef) as ServerLoad | undefined;
}

/** Whether the server is currently throttling free users. */
export function isServerOverloaded(load: ServerLoad | undefined): boolean {
  return (load?.level ?? 0) > 0;
}

// Mirror of OVERLOAD_SENTINEL in convex/inference/billing.ts — keep in sync. An
// assistant message whose content is exactly this was turned away by the
// overload throttle, not a real model error.
export const OVERLOAD_SENTINEL = "__SERVER_OVERLOAD__";

/** True when an assistant message was blocked by the overload throttle. */
export function isOverloadSentinel(content: string | undefined): boolean {
  return content?.trim() === OVERLOAD_SENTINEL;
}
