const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

/*
 * The monorepo hoists shared dependencies, so metro has to watch and search
 * both node_modules trees — but *only* those. Watching the workspace root
 * pulled apps/legacy and apps/v2 into the crawl too, and holding handles open
 * across all of it left too few for the transform cache: builds died with
 * EMFILE part-way through, which surfaces as half-built modules and
 * "undefined is not a function" at runtime rather than as a build error.
 *
 * Nothing here imports another workspace package, so the app's own root plus
 * the hoisted node_modules is the whole picture. Add a package back the day
 * this app starts importing one.
 */
config.watchFolders = [path.resolve(workspaceRoot, "node_modules")];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

/*
 * Note: hierarchical lookup stays ON, even though Expo's monorepo guide turns
 * it off. Bun's isolated linker puts each package's transitive dependencies in
 * a nested node_modules under .bun/, and those are only reachable by walking up
 * from the requiring file. Disabling it breaks resolution deep inside Expo's
 * own packages.
 */

/*
 * Packages that must never be duplicated. With hierarchical lookup on, a
 * library whose react peer isn't linked in its own isolated .bun directory
 * walks up the tree, finds the web apps' copy, and we end up bundling two
 * Reacts — which surfaces as "invalid hook call". Every request for these
 * resolves as though it came from this app's root, collapsing them onto one
 * copy. Add to this list rather than debugging the hook error.
 */
const SINGLETONS = ["react", "react-dom", "react-native"];

const singletonOrigin = path.join(projectRoot, "index.js");

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = context.resolveRequest ?? defaultResolveRequest;
  const isSingleton = SINGLETONS.some(
    (name) => moduleName === name || moduleName.startsWith(`${name}/`),
  );

  if (!isSingleton) return resolve(context, moduleName, platform);

  return resolve(
    { ...context, originModulePath: singletonOrigin },
    moduleName,
    platform,
  );
};

/*
 * Metro reads one transform-cache file per module, and it fires them all at
 * once — a cold graph opens well over a thousand concurrently. Windows runs
 * out of handles part-way through and the build dies with EMFILE, which shows
 * up as half-built modules and "undefined is not a function" at runtime rather
 * than as a build error.
 *
 * The cache is worth keeping, so the reads are queued behind a fixed number of
 * slots rather than the store being turned off.
 */
const CACHE_SLOTS = 64;

function createQueue(limit) {
  let active = 0;
  const waiting = [];

  const pump = () => {
    if (active >= limit || waiting.length === 0) return;
    active += 1;
    const { run, resolve, reject } = waiting.shift();
    // `run` may throw synchronously; resolve() funnels that into the rejection.
    Promise.resolve()
      .then(run)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        pump();
      });
  };

  return (run) =>
    new Promise((resolve, reject) => {
      waiting.push({ run, resolve, reject });
      pump();
    });
}

const queue = createQueue(CACHE_SLOTS);

for (const store of config.cacheStores ?? []) {
  const read = store.get.bind(store);
  const write = store.set.bind(store);
  store.get = (key) => queue(() => read(key));
  store.set = (key, value) => queue(() => write(key, value));
}

module.exports = config;
