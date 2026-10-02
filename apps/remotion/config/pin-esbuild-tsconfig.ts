import type { WebpackConfiguration } from "@remotion/cli/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Remotion's esbuild-loader reads our tsconfig by `require("typescript")` and
 * calling `typescript.sys.readFile`. In this monorepo that require lands on
 * TypeScript 7 — the native rewrite, which has no `sys` — and the loader dies
 * on the first .tsx it touches, so neither the studio nor a render ever boots.
 *
 * The loader only reaches for TypeScript when `tsconfigRaw` is absent, so we
 * hand it ours up front and it never looks. Config-only: it changes nothing
 * about how our code compiles.
 */

const ESBUILD_LOADER = "esbuild-loader";

/** Remotion passes the project root through to its esbuild-loader. */
type LoaderUse = {
  loader?: string;
  options?: { remotionRoot?: string } & Record<string, unknown>;
};

/** Webpack's `use` is a wide union; we only care about object-shaped loaders. */
function loaderUses(rule: unknown): LoaderUse[] {
  const use = (rule as { use?: unknown } | null)?.use;
  if (!use) return [];
  const list = Array.isArray(use) ? use : [use];
  return list.filter(
    (entry): entry is LoaderUse => typeof entry === "object" && entry !== null,
  );
}

function readTsconfig(remotionRoot: string): unknown {
  const path = join(remotionRoot, "tsconfig.json");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `pin-esbuild-tsconfig: could not read ${path}, which Remotion's ` +
        `esbuild-loader needs to compile TypeScript. ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

/** Injects `tsconfigRaw` into every esbuild-loader rule in a webpack config. */
export function pinEsbuildTsconfig(
  config: WebpackConfiguration,
): WebpackConfiguration {
  const rules = config.module?.rules;
  if (!rules) return config;

  // One tsconfig per root, read lazily so a config without esbuild-loader
  // never touches the disk.
  const cache = new Map<string, unknown>();
  let pinned = 0;

  for (const rule of rules) {
    for (const use of loaderUses(rule)) {
      if (!use.loader?.includes(ESBUILD_LOADER)) continue;

      const root = use.options?.remotionRoot;
      if (!root) {
        throw new Error(
          "pin-esbuild-tsconfig: Remotion's esbuild-loader no longer receives " +
            "`remotionRoot`, so we can't find tsconfig.json. Re-check this " +
            "override against @remotion/bundler.",
        );
      }

      if (!cache.has(root)) cache.set(root, readTsconfig(root));
      use.options = { ...use.options, tsconfigRaw: cache.get(root) };
      pinned += 1;
    }
  }

  if (pinned === 0) {
    throw new Error(
      "pin-esbuild-tsconfig: found no esbuild-loader rule to pin. Remotion " +
        "probably restructured its webpack config — re-check this override " +
        "against @remotion/bundler.",
    );
  }

  return config;
}
