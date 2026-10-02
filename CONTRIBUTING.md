# Contributing to Whirl

First off: thank you. Whirl is a small project that cares a lot about how
things feel, and contributions of every size are welcome, from typo fixes to
whole features.

## Before you start

- **Bugs:** search the [issues](https://github.com/whirlchat/whirl/issues)
  first, then open one with steps to reproduce.
- **Features and bigger changes:** open an issue or discussion before writing
  a lot of code, so we can agree on the shape of it together. It saves
  everyone a rewrite.
- **Security problems:** please don't file a public issue. See
  [SECURITY.md](SECURITY.md).

## Setting up

Follow the [self-hosting guide](docs/self-hosting.md) to get a local copy
running. The short version:

```sh
bun install
cd packages/backend && bunx convex dev          # first run creates a dev deployment
cp apps/v2/.env.example apps/v2/.env.local      # fill in Convex + Clerk
bun run dev                                     # from the repo root
```

You only need Convex, Clerk, and OpenRouter to work on Whirl. Billing,
search, memory, and the rest are optional, and the app hides what isn't
configured.

Whirl uses **[Bun](https://bun.sh)** for everything. Please don't use npm,
yarn, or pnpm. They don't understand the `workspace:*` links and will leave
`node_modules` in a broken state.

## Where things live

| Path               | What it is                                                  |
| ------------------ | ----------------------------------------------------------- |
| `apps/v2`          | The web app (Next.js). This is the one that ships.          |
| `packages/backend` | The Convex backend: schema, queries, mutations, AI pipeline |
| `apps/console`     | Admin console for models, integrations, and skills (Vite)   |
| `apps/mobile`      | Native app (Expo)                                           |
| `apps/waitlist`    | Standalone waitlist page                                    |
| `apps/remotion`    | Promo video compositions                                    |
| `apps/legacy`      | The previous web app. Frozen; please don't send PRs here.   |

See [docs/architecture.md](docs/architecture.md) for how a message travels
from the composer to the model and back.

## Making changes

### Checks

Run the type checker from inside the package you touched (running `tsc` from
the repo root picks up the wrong binary):

```sh
cd apps/v2 && bunx tsc --noEmit
cd packages/backend && bunx tsc -p convex --noEmit
```

Backend tests use two runners: Bun's for most suites and Vitest (in Convex's
edge runtime) for the Token Arcade:

```sh
cd packages/backend
bun test tests convex/lockedPolicy.test.ts
bunx vitest run
```

CI runs all of these on every pull request.

If you add or rename a Convex function, regenerate the bindings so the apps
see it:

```sh
cd packages/backend && bunx convex codegen
```

### Code style

- **Small files.** Split things up before a file grows past a few hundred
  lines, and pull anything reusable into its own component.
- **Readable over clever.** Clear names, consistent formatting, and comments
  that explain _why_, not _what_.
- **Errors are part of the UI.** Every failure the user can hit should end in
  a message they understand, on both the frontend and the backend. No raw
  stack traces, no silent failures.
- **Icons** come from [`@tabler/icons-react`](https://tabler.io/icons). Prefer
  the filled variants where they read well.
- **Copy** in the app uses proper sentence casing.

### UI changes

- Check **light and dark mode**, every time.
- Match the existing design language: flat surfaces (no drop shadows or
  gradients), pill-shaped controls, and a monochrome palette. If a pattern
  already exists for what you're building, reuse it rather than inventing a
  new one.
- Motion should be smooth and interruptible. Jank is a bug.
- Include a screenshot or short clip in your pull request.

### Long-session hygiene

Whirl tabs stay open for hours, so leaks are correctness bugs, not polish:

- Every listener, observer, timer, and `requestAnimationFrame` needs a
  teardown that actually runs, including when a component unmounts
  mid-flight.
- Every module-level `Map` or `Set` needs an eviction path. Key entries on a
  stable id and overwrite them; never key on `id:revision`.
- Anything kept mounted offscreen must stay small, because it still
  re-renders on every Convex update.

### Convex

Read [`packages/backend/convex/_generated/ai/guidelines.md`](packages/backend/convex/_generated/ai/guidelines.md)
before writing backend code. It covers validators, indexes, and the
query/mutation/action split, and it overrides older habits.

### Line endings

The repository has a mix of CRLF and LF files. Keep whatever a file already
uses. If your editor normalized a whole file, restore the untouched lines
with:

```sh
bun apps/legacy/scripts/fix-endings.mjs <repo-relative-path>
```

## Pull requests

1. Fork the repo and branch off `main`.
2. Keep each PR focused on one change. Several small PRs beat one huge one.
3. Write commit messages in the imperative mood ("Add folder sharing", not
   "Added folder sharing").
4. Fill in the PR template: what changed, why, and how you tested it.
5. Make sure the type checks above pass.

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
