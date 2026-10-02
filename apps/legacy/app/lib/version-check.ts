import { useEffect } from "react";
import { makeFunctionReference } from "convex/server";
import { useQuery } from "convex/react";

import { dismissToast, showUpdateToast, UPDATE_TOAST_ID } from "~/data/toasts";

const currentDeployment = makeFunctionReference<"query">("deployment:current");

type DeploymentVersion = { version: string; updatedAt: number } | null;

/**
 * Watches for new production deployments. The running client carries the
 * version it was built with (`__APP_VERSION__`); Convex pushes the live
 * production version over the existing WebSocket. When they diverge, a newer
 * client has shipped, so we surface a persistent toast prompting a reload.
 *
 * The toast is driven reactively: shown while the versions differ, dismissed
 * the moment they match again. That self-heals the brief window during a deploy
 * switchover where a freshly-loaded client may observe the previous version
 * before the webhook lands.
 *
 * Only runs in production — previews and local dev share a Convex backend but
 * carry their own SHAs, which would otherwise read as a perpetual mismatch.
 */
export function useVersionWatcher() {
  const isProduction = __APP_ENV__ === "production";
  const current = useQuery(
    currentDeployment,
    isProduction ? {} : "skip",
  ) as DeploymentVersion | undefined;

  useEffect(() => {
    // undefined = still loading / skipped; null = no deploy recorded yet.
    if (!current) return;
    if (current.version !== __APP_VERSION__) {
      showUpdateToast(() => window.location.reload());
    } else {
      dismissToast(UPDATE_TOAST_ID);
    }
  }, [current?.version]);
}
