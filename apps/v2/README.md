# Whirl web app

The Next.js app behind [whirl.chat](https://whirl.chat). It talks to the
Convex backend in [`packages/backend`](../../packages/backend) for nearly
everything, and signs people in with Clerk.

## Running it

Set up the backend and environment first; the
[self-hosting guide](../../docs/self-hosting.md) walks through it. Then:

```sh
cp .env.example .env.local   # fill in Convex + Clerk
bun run dev                  # http://localhost:3000
```

`bun run dev` also rebuilds the artifact runtime (`public/artifact-runtime.js`),
the bundle sandboxed React artifacts run on.

## Layout

| Path            | What's there                                                   |
| --------------- | -------------------------------------------------------------- |
| `app/`          | Routes. `(shell)` is the chat app; `about`, `pricing`, and `share` are public pages |
| `components/`   | UI, grouped by feature (`thread/`, `settings/`, `integrations/`, ...) |
| `components/ui` | Shared primitives: dialogs, buttons, menus                     |
| `lib/`          | Hooks, caches, and helpers; `lib/site.ts` holds the instance's name and links |
| `public/`       | Static assets, fonts, and the service worker                   |
| `scripts/`      | Build helpers and screenshot tooling                           |

`/debug` is a workbench for the thread view: every message state, a fake
streaming reply, and previews of one-off modals, all without a backend.

## Checks

```sh
bunx tsc --noEmit
bun run lint
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for conventions.
