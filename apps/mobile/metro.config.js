const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Metro only watches the project folder by default. In a pnpm monorepo,
// packages/shared lives outside apps/mobile, so Metro needs to watch the
// workspace root too, or edits there won't trigger a rebuild.
config.watchFolders = [workspaceRoot];

// With a hoisted node_modules (see apps/mobile/.npmrc), every dependency -
// including packages/shared's own deps like zod - ends up resolvable from
// either the app's or the workspace root's node_modules. Metro needs both
// on its lookup path.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// packages/shared's relative imports use the TypeScript "NodeNext" ESM
// convention (e.g. `./roles.js`), which points at a `.ts` source file, not
// an actual `.js` file - tsc and Vite (api, web) resolve this natively, but
// Metro doesn't, and fails with "Unable to resolve ./roles.js from
// packages/shared/src/index.ts". For a relative import ending in `.js`,
// try the same path with `.ts`/`.tsx` first; only fall back to Metro's
// normal resolution (which covers real `.js` files, e.g. inside
// node_modules) if neither exists. Scoped to relative imports only, so
// non-relative imports (packages, `@employee-saas/shared` itself) are
// untouched, and packages/shared's own source is left as-is since api and
// web both depend on its current import style.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    const withoutExtension = moduleName.slice(0, -3);
    for (const ext of [".ts", ".tsx"]) {
      try {
        return context.resolveRequest(context, `${withoutExtension}${ext}`, platform);
      } catch {
        // Not found with this extension - try the next one, then fall
        // through to the normal .js resolution below.
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
