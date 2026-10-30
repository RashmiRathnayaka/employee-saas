import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./src/test/setupEnv.ts", "./src/test/setupDb.ts"],
    // setupDb.ts truncates every table before each test runs. All test
    // files share the one employee_saas_test database, so if two files ran
    // at the same time, one file's truncate could wipe rows another file's
    // test just created (or is mid-assertion on) - a race, not just slow
    // tests. Forcing fileParallelism off makes the whole suite run one test
    // file at a time, so that truncate-before-each-test is actually safe.
    fileParallelism: false,
  },
});
