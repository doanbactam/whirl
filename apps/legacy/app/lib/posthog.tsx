import { useEffect, useRef, type ReactNode } from "react";
import { useAuth, useUser } from "@clerk/tanstack-react-start";
import { PostHogProvider, usePostHog } from "@posthog/react";
import posthog from "posthog-js";

// PostHog config comes from build-time env. Both are safe to expose to the
// browser (the project token is a public, write-only ingest key). When the
// token is absent — local dev, contributors who haven't set it up — analytics
// quietly no-ops instead of erroring.
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN as
  | string
  | undefined;
const POSTHOG_HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ??
  "https://us.i.posthog.com";

export const analyticsEnabled = Boolean(POSTHOG_KEY);

/**
 * Canonical event names. Keep them snake_case and centralized so the same
 * string is never typed twice and the taxonomy stays easy to skim.
 *
 * Autocapture (enabled via the 2026 defaults) already records raw clicks,
 * pageviews and form submits — so these are the *intentful, property-rich*
 * events that tell us what people actually do, not where they clicked.
 */
export const ANALYTICS_EVENTS = {
  // Conversation
  messageSent: "message_sent",
  generationStopped: "generation_stopped",
  messageRetried: "message_retried",
  messageEdited: "message_edited",
  messageCopied: "message_copied",
  codeBlockDownloaded: "code_block_downloaded",
  messageEditStarted: "message_edit_started",
  messageExpanded: "message_expanded",
  messageQuoted: "message_quoted",
  streamStalled: "stream_stalled",
  chatScrolledToLatest: "chat_scrolled_to_latest",
  autoScrollToggled: "auto_scroll_toggled",

  // Composer / model configuration
  modelSelected: "model_selected",
  thinkingToggled: "thinking_toggled",
  searchToggled: "search_toggled",
  attachmentAdded: "attachment_added",
  attachmentRemoved: "attachment_removed",
  attachmentPreviewOpened: "attachment_preview_opened",
  attachmentEdited: "attachment_edited",
  attachmentOpenedInNewTab: "attachment_opened_in_new_tab",
  attachmentUploadFailed: "attachment_upload_failed",
  documentExtracted: "document_extracted",
  longPastePrompted: "long_paste_prompted",
  longPasteResolved: "long_paste_resolved",
  pastePromptToggled: "paste_prompt_toggled",
  commandMenuUsed: "command_menu_used",

  // Message detail surfaces
  reasoningOpened: "reasoning_opened",
  sourcesOpened: "sources_opened",
  sourceLinkClicked: "source_link_clicked",
  calculationOpened: "calculation_opened",
  toolChainExpanded: "tool_chain_expanded",
  attachmentImageOpened: "attachment_image_opened",
  documentSidebarOpened: "document_sidebar_opened",
  documentSidebarClosed: "document_sidebar_closed",
  documentSidebarEdited: "document_sidebar_edited",
  documentEditsAttached: "document_edits_attached",
  documentEditsDiscarded: "document_edits_discarded",
  documentDownloaded: "document_downloaded",
  // whirl-authored documents
  documentCardOpened: "document_card_opened",
  documentManuallyEdited: "document_manually_edited",
  documentSelectionAddedToChat: "document_selection_added_to_chat",
  documentFullscreenToggled: "document_fullscreen_toggled",
  documentTableInserted: "document_table_inserted",
  documentFormulaInserted: "document_formula_inserted",
  // whirl-authored HTML artifacts (inline visualizations + full pages)
  htmlCardOpened: "html_card_opened",
  htmlFullscreenToggled: "html_fullscreen_toggled",
  htmlDownloaded: "html_downloaded",
  htmlOpenedInNewTab: "html_opened_in_new_tab",
  htmlLinkCopied: "html_link_copied",

  // Weather widget
  weatherWidgetShown: "weather_widget_shown",
  weatherPreciseLocationRequested: "weather_precise_location_requested",

  // Threads
  threadOpened: "thread_opened",
  threadRenamed: "thread_renamed",
  threadDeleted: "thread_deleted",
  threadDeleteUndone: "thread_delete_undone",
  threadPinToggled: "thread_pin_toggled",
  threadModelChanged: "thread_model_changed",
  threadCompacted: "thread_compacted",
  threadBranched: "thread_branched",
  threadRolledBack: "thread_rolled_back",
  threadShared: "thread_shared",
  threadShareRevoked: "thread_share_revoked",
  threadShareLinkCopied: "thread_share_link_copied",
  threadShareRawOpened: "thread_share_raw_opened",
  sharedThreadViewed: "shared_thread_viewed",
  sharedThreadLinkCopied: "shared_thread_link_copied",
  sharedThreadForked: "shared_thread_forked",
  threadArtifactsMenuOpened: "thread_artifacts_menu_opened",
  threadArtifactOpened: "thread_artifact_opened",

  // Sidebar folders
  folderCreated: "folder_created",
  folderRenamed: "folder_renamed",
  folderDeleted: "folder_deleted",
  folderToggled: "folder_toggled",
  foldersReordered: "folders_reordered",
  threadFolderChanged: "thread_folder_changed",

  // Incognito
  incognitoEntered: "incognito_entered",
  incognitoExited: "incognito_exited",

  // About mini-site (the SSR'd marketing pages under /about)
  aboutNavClicked: "about_nav_clicked",
  aboutResourceClicked: "about_resource_clicked",
  aboutChatCtaClicked: "about_chat_cta_clicked",
  aboutCtaClicked: "about_cta_clicked",
  aboutComposerSubmitted: "about_composer_submitted",

  // Navigation / discovery
  searchOpened: "search_opened",
  searchResultSelected: "search_result_selected",
  sidebarToggled: "sidebar_toggled",
  footerLinkClicked: "footer_link_clicked",
  legalLinkClicked: "legal_link_clicked",
  contactEmailCopied: "contact_email_copied",

  // Settings & preferences
  settingsOpened: "settings_opened",
  settingsTabSwitched: "settings_tab_switched",
  themeChanged: "theme_changed",
  unitsChanged: "units_changed",
  statsToggled: "stats_toggled",
  profileUpdated: "profile_updated",
  profilePhotoChanged: "profile_photo_changed",
  preferencesSaved: "preferences_saved",

  // Memory
  memorySaved: "memory_saved",
  memoryToggled: "memory_toggled",
  memoryEdited: "memory_edited",
  memoryDeleted: "memory_deleted",
  memoryCleared: "memory_cleared",
  memoryIndicatorOpened: "memory_indicator_opened",

  // MCP servers
  mcpServerAdded: "mcp_server_added",
  mcpServerUpdated: "mcp_server_updated",
  mcpServerRemoved: "mcp_server_removed",
  mcpServerToggled: "mcp_server_toggled",
  mcpServerTestRun: "mcp_server_test_run",
  mcpOAuthStarted: "mcp_oauth_started",
  mcpOAuthConnected: "mcp_oauth_connected",
  mcpOAuthDisconnected: "mcp_oauth_disconnected",

  // Integration store
  integrationsPageOpened: "integrations_page_opened",
  integrationsTabSwitched: "integrations_tab_switched",
  integrationModalOpened: "integration_modal_opened",
  integrationLinkCopied: "integration_link_copied",
  integrationInstalled: "integration_installed",
  integrationOAuthStarted: "integration_oauth_started",
  integrationOAuthConnected: "integration_oauth_connected",
  integrationToggled: "integration_toggled",
  integrationUninstalled: "integration_uninstalled",
  integrationsShowMore: "integrations_show_more",
  integrationsConsoleLinkClicked: "integrations_console_link_clicked",
  integrationMentioned: "integration_mentioned",
  // Whirl-suggested install cards in chat ("integrations_suggested" itself
  // fires server-side when the model searches the store)
  integrationSuggestionShown: "integration_suggestion_shown",
  integrationSuggestionClicked: "integration_suggestion_clicked",

  // Skill store ("skill_loaded" itself fires server-side when the model
  // pulls a skill's instructions into a chat turn)
  skillModalOpened: "skill_modal_opened",
  skillMentioned: "skill_mentioned",
  skillLinkCopied: "skill_link_copied",
  skillInstalled: "skill_installed",
  skillToggled: "skill_toggled",
  skillUninstalled: "skill_uninstalled",

  // Image generation ("image_generated" itself fires server-side)
  imageTagMentioned: "image_tag_mentioned",
  generatedImageCopied: "generated_image_copied",
  generatedImageDownloaded: "generated_image_downloaded",

  // Markdown-embedded images (in-prose ![alt](url) renders)
  markdownImageOpened: "markdown_image_opened",
  markdownImageFailed: "markdown_image_failed",

  // Mermaid diagrams (```mermaid fences rendered as diagram cards)
  mermaidDiagramRendered: "mermaid_diagram_rendered",
  mermaidDiagramFailed: "mermaid_diagram_failed",
  mermaidOpenedInNewTab: "mermaid_opened_in_new_tab",
  mermaidSourceCopied: "mermaid_source_copied",

  // Auth
  authStarted: "auth_started",
  authCompleted: "auth_completed",
  authModeSwitched: "auth_mode_switched",
  passwordResetRequested: "password_reset_requested",
  passwordResetCompleted: "password_reset_completed",
  emailVerificationCompleted: "email_verification_completed",
  sessionExpiredPrompted: "session_expired_prompted",
  sessionExpiredRetried: "session_expired_retried",

  // Billing
  upgradeModalOpened: "upgrade_modal_opened",
  planCheckoutStarted: "plan_checkout_started",
  planPricesLocalized: "plan_prices_localized",
  subscriptionCancelled: "subscription_cancelled",
  billingPortalOpened: "billing_portal_opened",
  extraUsageTopupStarted: "extra_usage_topup_started",
  extraUsageTopupCompleted: "extra_usage_topup_completed",

  // Feedback
  feedbackOpened: "feedback_opened",
  feedbackSubmitted: "feedback_submitted",
  feedbackFailed: "feedback_failed",

  // Misc
  resetNoticeAcknowledged: "reset_notice_acknowledged",
  serverOverloadShown: "server_overload_shown",
} as const;

export type AnalyticsEvent =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/**
 * Wraps the app in PostHog when a key is configured, otherwise renders the
 * children untouched. `defaults: '2026-01-30'` opts into the modern preset:
 * SPA pageviews via the History API (right for TanStack Router), autocapture,
 * and web vitals — so we only hand-roll the events autocapture can't infer.
 */
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

/**
 * Returns a capture function that's always safe to call: it no-ops until
 * PostHog has actually loaded (or forever, when analytics is disabled), so
 * callers never have to null-check.
 */
export function useCapture() {
  const client = usePostHog();
  return (event: AnalyticsEvent, properties?: Record<string, unknown>) => {
    if (!client?.__loaded) return;
    client.capture(event, properties);
  };
}

/**
 * Capture helper for plain (non-React) module code — e.g. the toast store —
 * that can't use the {@link useCapture} hook. `PostHogProvider` initializes
 * the same global `posthog-js` singleton this reaches for, so events line up.
 */
export function captureEvent(
  event: AnalyticsEvent,
  properties?: Record<string, unknown>,
) {
  if (!posthog?.__loaded) return;
  posthog.capture(event, properties);
}

/**
 * Links captured events to the signed-in Clerk user, and unlinks them on
 * logout. Uses the Clerk user id as the distinct id so it lines up with the
 * `distinctId` Convex sends on server-side LLM events. Mount once, near the
 * root.
 */
export function useIdentifyUser() {
  const posthog = usePostHog();
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (!posthog?.__loaded) return;

    if (isSignedIn && user) {
      posthog.identify(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        name: user.fullName ?? user.username ?? undefined,
      });
      wasSignedIn.current = true;
    } else if (!isSignedIn && wasSignedIn.current) {
      // Only reset on an actual sign-out, not on the initial signed-out
      // render — resetting churns the anonymous id for no reason.
      posthog.reset();
      wasSignedIn.current = false;
    }
  }, [posthog, isSignedIn, user]);
}
