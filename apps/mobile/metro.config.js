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

module.exports = config;
