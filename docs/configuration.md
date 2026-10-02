# Configuration

Whirl reads its configuration from environment variables in two places:

- **The Convex deployment**, for everything the backend does. Set these with
  `bunx convex env set NAME value` from `packages/backend` (add `--prod` for
  production), or in the Convex dashboard. They never go in a file.
- **The web app** (`apps/v2/.env.local` locally, your host's settings in
  production).

A few secrets have to match on both sides; they're marked _shared_ below.

## The minimum

| Where    | Variable                            | What it's for                                         |
| -------- | ----------------------------------- | ----------------------------------------------------- |
| Convex   | `CLERK_JWT_ISSUER_DOMAIN`           | Your Clerk Frontend API URL, so Convex trusts sign-ins |
| Convex   | `OPENROUTER_API_KEY`                | Every model call: chat, titles, images, transcription |
| Convex   | `SITE_URL`                          | The web app's public origin, for share links, OAuth returns, and emails. Defaults to `http://localhost:3000` |
| Web app  | `NEXT_PUBLIC_CONVEX_URL`            | Your deployment's `.convex.cloud` URL                 |
| Web app  | `NEXT_PUBLIC_CONVEX_SITE_URL`       | Your deployment's `.convex.site` URL                  |
| Web app  | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key                                 |
| Web app  | `CLERK_SECRET_KEY`                  | Clerk secret key                                      |
| Web app  | `NEXT_PUBLIC_SITE_URL`              | Public origin for canonical URLs and share cards. Filled in automatically on Vercel |

With just these, you get the full chat experience: every model, thinking,
artifacts, sharing, folders, locked and incognito chats, and image
generation.

## Optional features

Each of these switches on with its keys. Until then, Whirl hides the
controls it can't honor instead of letting them fail.

| Feature              | Where  | Variables                                  | Without it                                                          |
| -------------------- | ------ | ------------------------------------------ | ------------------------------------------------------------------- |
| Integrations (MCP)   | Convex | `MCP_ENCRYPTION_KEY`                       | Connecting an integration that stores credentials fails with a clear error |
| Web search           | Convex | `EXA_API_KEY`                              | The search toggle hides, and replies run without the web            |
| Long-term memory     | Convex | `SUPERMEMORY_API_KEY`                      | Memory stays off                                                    |
| Billing              | Convex | `AUTUMN_SECRET_KEY`                        | Everyone gets every feature, nothing is metered, and plan UI hides |
| Composio integrations| Convex | `COMPOSIO_API_KEY`                         | Composio listings can't be installed                                |
| Support agent        | Both   | `MEDIAN_KEY`, `MEDIAN_SUPPORT_SECRET` (shared) | The Support menu item hides                                     |
| Kirkify              | Both   | `KIRKIFY_SECRET` (shared)                  | `/kirkify` returns 404 and drops out of the nav and sitemap         |

### Integrations

`MCP_ENCRYPTION_KEY` encrypts the headers and OAuth tokens Whirl stores for
each integration. It must decode to exactly 32 bytes:

```sh
bunx convex env set MCP_ENCRYPTION_KEY "$(openssl rand -base64 32)"
```

Don't rotate it casually: credentials encrypted with the old key can't be
read with a new one, so everyone would have to reconnect.

### Billing

Billing runs on [Autumn](https://useautumn.com), with Stripe behind it. If
you set `AUTUMN_SECRET_KEY`, your Autumn account needs these products and
features, because the gates in
[`convex/inference/billing.ts`](../packages/backend/convex/inference/billing.ts)
look them up by id.

**Products**

| Id              | Role                                                    |
| --------------- | ------------------------------------------------------- |
| `mini`, `turbo`, `mega` | The paid plans, smallest to largest             |
| `platinum`, `platinum_max` | The invite-only premium line (`convex/platinum.ts`) |
| `extra_usage`   | A top-up add-on                                         |

**Features**

| Id                               | Type                | Role                                           |
| -------------------------------- | ------------------- | ---------------------------------------------- |
| `messages`                       | Metered, count      | The free plan's message allowance              |
| `usage`                          | Metered, USD        | The paid plans' shared usage pool              |
| `extra_usage`                    | Metered, USD        | The top-up balance, drawn after `usage`        |
| `ai_cost`, `search`              | Metered, USD        | What turns and searches deduct from the pool   |
| `basic`, `pro`, `max`            | Boolean             | Plan entitlements (any one means "paid")       |
| `reasoning`, `can_search`        | Boolean             | Thinking and web search entitlements           |

The pricing page reads its plans from Autumn, so names, prices, and
allowances are yours to set.

## Observability

All optional, all off by default.

| Service      | Where   | Variables                                                         |
| ------------ | ------- | ----------------------------------------------------------------- |
| PostHog      | Web app | `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_HOST`  |
| PostHog      | Convex  | `POSTHOG_PROJECT_TOKEN`, `POSTHOG_HOST`, `POSTHOG_LLM_PRIVACY_MODE` |
| Axiom        | Web app | `AXIOM_TOKEN`, `AXIOM_DATASET`                                    |
| Axiom        | Convex  | `AXIOM_TOKEN`, `AXIOM_DATASET`, `AXIOM_HOST`                      |
| Braintrust   | Convex  | `BRAINTRUST_API_KEY`, plus `BRAINTRUST_PROJECT_ID` or `BRAINTRUST_PROJECT_NAME` (default `Whirl`) |

Set `POSTHOG_LLM_PRIVACY_MODE=true` to keep prompt and reply text out of
PostHog's LLM analytics events.

### The free-tier overload throttle

When billing is on, Whirl can tighten free users' daily message cap while
free traffic is expensive. It reads today's free-tier spend from a saved
PostHog endpoint:

| Variable                     | Value                                                          |
| ---------------------------- | -------------------------------------------------------------- |
| `POSTHOG_PERSONAL_API_KEY`   | A personal API key with read access                            |
| `POSTHOG_FREE_COST_ENDPOINT` | The endpoint's `/run` URL, returning today's free spend in USD |

Leave either unset and the throttle never engages.

## Email

| Variable               | Where  | What it's for                                                        |
| ---------------------- | ------ | -------------------------------------------------------------------- |
| `RESEND_API_KEY`       | Convex | Sending through [Resend](https://resend.com)                         |
| `RESEND_FROM_EMAIL`    | Convex | The sender, on a domain verified in Resend, like `Whirl <hello@your-domain>` |
| `RESEND_AUDIENCE_ID`   | Convex | The audience new sign-ups are added to                               |
| `CLERK_WEBHOOK_SECRET` | Convex | Verifies Clerk's webhook at `https://<name>.convex.site/api/clerk-webhook` |

## Deployment

| Variable                 | Where   | What it's for                                                                  |
| ------------------------ | ------- | ------------------------------------------------------------------------------ |
| `VERCEL_WEBHOOK_SECRET`  | Convex  | Verifies Vercel's deploy webhook at `/api/deploy-hook`, which prompts open tabs to refresh after a release |
| `GIT_COMMIT_SHA`         | Web app | The build's version, for that same prompt. Vercel provides its own              |
| `DEV_ALLOWED_ORIGINS`    | Web app, console | Extra hosts allowed to reach the dev server, comma-separated            |

Older deployments may still set the site origin as `WHIRL_SITE_URL`,
`APP_ORIGIN`, or `CLIENT_ORIGIN`. Those keep working, but `SITE_URL` wins
when it's set.

## Other apps

**Console** (`apps/console/.env.local`)

| Variable                     | What it's for                              |
| ---------------------------- | ------------------------------------------ |
| `VITE_CONVEX_URL`            | Same deployment as the web app             |
| `VITE_CLERK_PUBLISHABLE_KEY` | Same Clerk instance as the web app         |
| `VITE_APP_URL`               | The web app's address, for "Open Whirl"    |
| `VITE_POSTHOG_PROJECT_TOKEN`, `VITE_POSTHOG_HOST` | Optional analytics    |

**Mobile** (`apps/mobile/.env.local`)

| Variable                            | What it's for                     |
| ----------------------------------- | --------------------------------- |
| `EXPO_PUBLIC_CONVEX_URL`            | Same deployment as the web app    |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Same Clerk instance               |
| `EXPO_PUBLIC_SITE_URL`              | The web app's origin, for share links |

**Waitlist** (`apps/waitlist/.env.local`): `RESEND_API_KEY` and
`RESEND_AUDIENCE_ID`.
