# Self-hosting Whirl

This guide takes you from a fresh clone to a running Whirl, first on your
machine and then in production. Budget about half an hour the first time.

Whirl needs three services to run:

| Service                                | What it does                        | Free tier |
| -------------------------------------- | ----------------------------------- | --------- |
| [Convex](https://convex.dev)           | Database, backend functions, crons  | Yes       |
| [Clerk](https://clerk.com)             | Sign-in and user accounts           | Yes       |
| [OpenRouter](https://openrouter.ai)    | Every model call                    | Pay as you go |

Everything else is optional. [Configuration](configuration.md) lists what
each extra service unlocks.

## 1. Prerequisites

- [Bun](https://bun.sh) 1.2 or newer. Whirl is a Bun workspace; npm, yarn,
  and pnpm won't install it correctly.
- [Git](https://git-scm.com)
- Accounts on the three services above

```sh
git clone https://github.com/whirlchat/whirl.git
cd whirl
bun install
```

## 2. Set up Clerk

1. Create an application in the [Clerk dashboard](https://dashboard.clerk.com)
   and turn on the sign-in methods you want (email, Google, and so on).
2. Open **Configure → JWT templates**, choose **New template → Convex**, and
   keep the name **`convex`**. The backend only accepts tokens from a template
   with exactly that name.
3. Optional, but you'll want it later: in the template's claims, add a role
   claim so you can make yourself an admin.

   ```json
   {
     "role": "{{user.public_metadata.role}}"
   }
   ```

4. Note down three values:
   - the **Frontend API URL** (looks like `https://your-instance.clerk.accounts.dev`)
   - the **publishable key** (`pk_test_...`)
   - the **secret key** (`sk_test_...`)

## 3. Set up Convex

The backend lives in `packages/backend`. Its first run creates a Convex
project and a personal dev deployment:

```sh
cd packages/backend
bunx convex dev
```

Log in when asked and create a new project. The first push stops with an
error about `CLERK_JWT_ISSUER_DOMAIN`. That's expected: the backend can't
verify sign-ins until it knows your Clerk instance. Leave that terminal
open, and in a second one, set the required variables:

```sh
cd packages/backend
bunx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-instance.clerk.accounts.dev
bunx convex env set OPENROUTER_API_KEY sk-or-v1-...
bunx convex env set SITE_URL http://localhost:3000
```

If you plan to connect integrations (MCP servers), also set an encryption key
for their stored credentials:

```sh
bunx convex env set MCP_ENCRYPTION_KEY "$(openssl rand -base64 32)"
```

Then restart `bunx convex dev` in the first terminal. It pushes the backend
and keeps watching for changes. Leave it running.

`bunx convex dev` wrote your deployment's URLs to `packages/backend/.env.local`.
You'll need both of them in the next step:

- `https://<name>.convex.cloud`
- `https://<name>.convex.site`

## 4. Configure the web app

```sh
cd apps/v2
cp .env.example .env.local
```

Fill in the required block:

```sh
NEXT_PUBLIC_CONVEX_URL=https://<name>.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://<name>.convex.site
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

## 5. Run it

From the repository root:

```sh
bun run dev
```

That starts three things side by side:

| Process | Address                                        |
| ------- | ---------------------------------------------- |
| Web app | [localhost:3000](http://localhost:3000)        |
| Console | [localhost:3001](http://localhost:3001)        |
| Convex  | watches `packages/backend/convex` and pushes   |

Prefer separate terminals? Use `bun run dev:v2`, `bun run dev:console`, and
`bun run dev:backend`.

Sign in, send a message, and you're up. 🎉

## 6. Make yourself an admin

Admins manage the model catalog, integrations, and skills from the console
(`apps/console`).

1. Make sure your Clerk `convex` JWT template includes the `role` claim from
   step 2.
2. In the Clerk dashboard, open your user and set **public metadata** to:

   ```json
   { "role": "admin" }
   ```

3. Sign out and back in so your token picks up the claim.
4. Set up the console's environment and open
   [localhost:3001](http://localhost:3001):

   ```sh
   cd apps/console
   cp .env.example .env.local   # same Convex URL and Clerk key as the web app
   ```

## 7. Turn on extras

Each optional service switches on as soon as its keys are set, and the
features it powers hide until then:

| To get...              | Set...                                  |
| ---------------------- | --------------------------------------- |
| Web search             | `EXA_API_KEY` on Convex                 |
| Long-term memory       | `SUPERMEMORY_API_KEY` on Convex         |
| Plans and billing      | `AUTUMN_SECRET_KEY` on Convex           |
| Product analytics      | PostHog keys on the web app and Convex  |
| The support agent      | `MEDIAN_KEY` on the web app and Convex  |

[Configuration](configuration.md) has the full list, including what billing
expects to find in your Autumn account.

> **About billing:** without `AUTUMN_SECRET_KEY`, every signed-in user gets
> every feature and nothing is metered. That's what you want for a personal
> or team instance. Each turn still records its provider cost, so the usage
> tab in settings stays accurate.

## 8. Deploy to production

### Backend

Create a production deployment and give it the same variables as dev:

```sh
cd packages/backend
bunx convex deploy
bunx convex env set --prod CLERK_JWT_ISSUER_DOMAIN https://clerk.your-domain
bunx convex env set --prod OPENROUTER_API_KEY sk-or-v1-...
bunx convex env set --prod SITE_URL https://your-domain
```

Use your Clerk **production** instance's Frontend API URL here, and add the
same `convex` JWT template to that instance.

To deploy on every push to `main`, add a `CONVEX_DEPLOY_KEY` secret (Convex
dashboard → Settings → Deploy keys) to your GitHub repository.
[`.github/workflows/deploy-convex.yml`](../.github/workflows/deploy-convex.yml)
picks it up automatically, and skips the deploy in any copy without one.

### Web app

Any host that runs Next.js works. On [Vercel](https://vercel.com):

1. Import the repository and set the **root directory** to `apps/v2`.
2. Add the environment variables from `apps/v2/.env.example`, using your
   production Convex and Clerk values.
3. Deploy.

On other hosts, also set `NEXT_PUBLIC_SITE_URL` to your public address, then
build and start from the repository root:

```sh
bun install
bun run build
bun run --cwd apps/v2 start
```

### Console (optional)

The console is a static Vite app. Build it with `bun run build:console` and
serve `apps/console/dist`, or import it into Vercel with the root directory
set to `apps/console`. Set `VITE_APP_URL` to the web app's address.

## Make it yours

Whirl's name, links, and legal pages live in one file:
[`apps/v2/lib/site.ts`](../apps/v2/lib/site.ts). Point the links at your own
status page, community, and policies, or set the optional ones to `null` to
hide them. On the backend, `APP_NAME` in
[`packages/backend/convex/site.ts`](../packages/backend/convex/site.ts) is
the name OpenRouter shows for your traffic.

The mobile app's bundle identifiers and Expo project live in
[`apps/mobile/app.json`](../apps/mobile/app.json). Change them before you
build your own copy.

## Troubleshooting

**"The server is missing part of its configuration" on every reply.**
`OPENROUTER_API_KEY` isn't set on the Convex deployment. Check with
`bunx convex env list`.

**Signed in, but every request is unauthenticated.**
The Clerk JWT template has to be named exactly `convex`, and
`CLERK_JWT_ISSUER_DOMAIN` has to match the instance you're signing in to.
Dev and production Clerk instances have different URLs.

**Locked chats fail to start.**
Set `NEXT_PUBLIC_CONVEX_SITE_URL` in the web app. Locked chats stream
straight from Convex's HTTP endpoint.

**Connecting an integration fails with an encryption error.**
Set `MCP_ENCRYPTION_KEY` on Convex (step 3).

**The dev server rejects requests from another device.**
Add that host to `DEV_ALLOWED_ORIGINS` in `apps/v2/.env.local`.
