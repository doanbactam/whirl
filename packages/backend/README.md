# @whirl/backend

the convex backend, living as its own workspace package so any app in the
monorepo can lean on it — not just the web app.

## using it

add it as a workspace dependency:

```json
"@whirl/backend": "workspace:*"
```

then import whatever you need by path:

```ts
import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";
```

there's intentionally no `exports` map — any file in `convex/` is fair game,
including shared helpers like `convex/inference/*`.

## developing

```sh
bun run dev      # convex dev (watches + pushes functions)
bun run codegen  # regenerate convex/_generated bindings
bun run deploy   # push to production
```

run these from `packages/backend` — the convex cli reads `.env.local` here
for the dev deployment. see `.env.example` for the server-side env vars the
deployment itself needs.
