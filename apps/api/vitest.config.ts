import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./src/test/setupEnv.ts", "./src/test/setupDb.ts"],
    fileParallelism: false,
  },
});
