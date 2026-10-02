import { useQuery } from "convex/react";

import { api } from "~/lib/backend";

/**
 * Server-authoritative admin state from the same Convex identity check that
 * guards every privileged query, mutation, and action. Undefined means the
 * authenticated token is still being checked.
 */
export function useIsAdmin(): boolean | undefined {
  return useQuery(api.admin.isAdmin);
}
