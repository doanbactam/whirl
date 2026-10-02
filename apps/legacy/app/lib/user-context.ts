import { useEffect, useState } from "react";
import { useUser } from "@clerk/tanstack-react-start";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";

import {
  readUnitsPref,
  type UnitsPref,
} from "~/lib/units";

const reportUserContextRef = makeFunctionReference<"mutation">(
  "userContext:report",
);

const reportPreciseLocationRef = makeFunctionReference<"mutation">(
  "userContext:reportPreciseLocation",
);

/**
 * Reads the browser's precise coordinates and reports them — but ONLY when the
 * geolocation permission has already been granted. We deliberately check the
 * Permissions API first so loading the app never triggers a permission prompt;
 * the timezone-derived location is always enough for "weather here", and
 * precise coordinates are a silent upgrade. The explicit opt-in path (the
 * "use precise location" pill on the widget) lives elsewhere and is allowed to
 * prompt because the user asked for it.
 */
async function reportPreciseLocationIfGranted(
  report: (args: { latitude: number; longitude: number }) => Promise<unknown>,
) {
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  // Without the Permissions API we can't know if reading would prompt, so we
  // stay quiet rather than risk an unsolicited popup.
  if (!navigator.permissions?.query) return;
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (status.state !== "granted") return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void report({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }).catch(() => {});
      },
      () => {
        // Permission was granted but the read failed (no fix, timeout) — fine,
        // the timezone fallback still covers us.
      },
      { maximumAge: 1000 * 60 * 30, timeout: 8000 },
    );
  } catch {
    // Some browsers don't support querying "geolocation"; just skip.
  }
}

/**
 * Silently reports the device's IANA timezone and locale once per session so
 * the model can know the user's local time and rough whereabouts. Pulled from
 * `Intl` / `navigator` — no permission prompt, the user is never asked. If the
 * user has previously granted geolocation, we also quietly refresh their
 * precise coordinates so "what's the weather here" can be pinpoint-accurate.
 */
export function useReportUserContext() {
  const { isSignedIn } = useUser();
  const report = useMutation(reportUserContextRef);
  const reportPrecise = useMutation(reportPreciseLocationRef);

  useEffect(() => {
    if (!isSignedIn) return;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone) return;
    void report({
      timeZone,
      locale: navigator.language || undefined,
      unitsSystem: readUnitsPref(),
    }).catch(() => {
      // Best-effort; never surface an error for background context.
    });
    void reportPreciseLocationIfGranted(reportPrecise);
  }, [isSignedIn, report, reportPrecise]);
}
