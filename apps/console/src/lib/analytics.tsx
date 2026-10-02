import { useEffect, useRef, type ReactNode } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { PostHogProvider, usePostHog } from "@posthog/react";
import posthog from "posthog-js";

// Same PostHog project as the main app — console events are prefixed with
// `console_` so the two surfaces stay easy to tell apart in one taxonomy.
// When the token is absent, analytics quietly no-ops instead of erroring.
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN as
  | string
  | undefined;
const POSTHOG_HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ??
  "https://us.i.posthog.com";

export const CONSOLE_EVENTS = {
  integrationCreated: "console_integration_created",
  integrationUpdated: "console_integration_updated",
  integrationToggled: "console_integration_toggled",
  integrationKeyRegenerated: "console_integration_key_regenerated",
  integrationKeyCopied: "console_integration_key_copied",
  integrationDeleted: "console_integration_deleted",
  integrationApproved: "console_integration_approved",
  integrationDenied: "console_integration_denied",
  integrationToolsScanned: "console_integration_tools_scanned",
  integrationToolsExported: "console_integration_tools_exported",
  integrationToolsImported: "console_integration_tools_imported",
  skillCreated: "console_skill_created",
  skillUpdated: "console_skill_updated",
  skillToggled: "console_skill_toggled",
  skillDeleted: "console_skill_deleted",
  skillApproved: "console_skill_approved",
  skillDenied: "console_skill_denied",
  composioCatalogSearched: "console_composio_catalog_searched",
  composioToolkitAdded: "console_composio_toolkit_added",
  composioToolkitToggled: "console_composio_toolkit_toggled",
  composioToolkitRemoved: "console_composio_toolkit_removed",
  modelDetected: "console_model_detected",
  modelCreated: "console_model_created",
  modelsImported: "console_models_imported",
  modelUpdated: "console_model_updated",
  modelToggled: "console_model_toggled",
  modelLegacyToggled: "console_model_legacy_toggled",
  modelDeleted: "console_model_deleted",
  modelTierCustomized: "console_model_tier_customized",
  modelTierReset: "console_model_tier_reset",
  modelTierAccessChanged: "console_model_tier_access_changed",
  modelProviderIconChanged: "console_model_provider_icon_changed",
  themeChanged: "console_theme_changed",
  signedOut: "console_signed_out",
} as const;

export type ConsoleEvent = (typeof CONSOLE_EVENTS)[keyof typeof CONSOLE_EVENTS];

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  if (!POSTHOG_KEY) return <>{children}</>;

  return (
    <PostHogProvider
      apiKey={POSTHOG_KEY}
      options={{
        api_host: POSTHOG_HOST,
        defaults: "2026-01-30",
        capture_exceptions: true,
      }}
    >
      {children}
    </PostHogProvider>
  );
}

/** A capture function that's always safe to call — no-ops until loaded. */
export function useCapture() {
  const client = usePostHog();
  return (event: ConsoleEvent, properties?: Record<string, unknown>) => {
    if (!client?.__loaded) return;
    client.capture(event, properties);
  };
}

/** Capture helper for plain (non-React) module code, e.g. the theme helper. */
export function captureEvent(
  event: ConsoleEvent,
  properties?: Record<string, unknown>,
) {
  if (!posthog?.__loaded) return;
  posthog.capture(event, properties);
}

/**
 * Links captured events to the signed-in Clerk user — same distinct id scheme
 * as the main app, so a developer's console and chat activity line up.
 */
export function useIdentifyUser() {
  const client = usePostHog();
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (!client?.__loaded) return;

    if (isSignedIn && user) {
      client.identify(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        name: user.fullName ?? user.username ?? undefined,
      });
      wasSignedIn.current = true;
    } else if (!isSignedIn && wasSignedIn.current) {
      client.reset();
      wasSignedIn.current = false;
    }
  }, [client, isSignedIn, user]);
}
