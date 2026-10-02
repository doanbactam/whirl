import { httpRouter } from "convex/server";

import { clerkWebhook } from "./clerk";
import { vercelDeployHook } from "./deployment";
import { streamAssistant, streamAssistantOptions } from "./inference";
import { integrationScanCallback } from "./integrationScan";
import {
  streamLockedTurn,
  streamLockedTurnOptions,
} from "./lockedInference";
import { composioOAuthCallback } from "./integrationStore";
import { mcpOAuthCallback } from "./mcpOAuthFlow";

const http = httpRouter();

http.route({
  path: "/assistant-stream",
  method: "POST",
  handler: streamAssistant,
});

// Locked threads generate in the tab that holds the key, so this one really
// is client-anchored: the browser POSTs its opened transcript and reads the
// reply back down the same connection. Nothing about the turn is stored on
// the way through. See convex/lockedInference.ts.
http.route({
  path: "/locked-stream",
  method: "POST",
  handler: streamLockedTurn,
});

http.route({
  path: "/locked-stream",
  method: "OPTIONS",
  handler: streamLockedTurnOptions,
});

// MCP OAuth redirect target. The provider sends the user back here with a code
// after they approve; the handler exchanges it for tokens and stores them.
http.route({
  path: "/mcp/oauth/callback",
  method: "GET",
  handler: mcpOAuthCallback,
});

// Same dance for the console's tool scanner: a short-lived, scan-scoped grant
// so an OAuth-protected MCP server can be tools/list-ed during registration.
http.route({
  path: "/mcp/oauth/scan-callback",
  method: "GET",
  handler: integrationScanCallback,
});

// Composio's hosted connect flow lands here after the user links an account
// for a Composio-backed extension; the handler verifies the account went
// ACTIVE with Composio before flipping the install to connected.
http.route({
  path: "/composio/oauth/callback",
  method: "GET",
  handler: composioOAuthCallback,
});

// Vercel deployment webhook → records the live production version so clients
// get pushed an "update available" prompt.
http.route({
  path: "/api/deploy-hook",
  method: "POST",
  handler: vercelDeployHook,
});

http.route({
  path: "/assistant-stream",
  method: "OPTIONS",
  handler: streamAssistantOptions,
});

// Clerk webhook → syncs newly-created users into a Resend audience. Verifies
// the Svix signature before acting.
http.route({
  path: "/api/clerk-webhook",
  method: "POST",
  handler: clerkWebhook,
});

export default http;
