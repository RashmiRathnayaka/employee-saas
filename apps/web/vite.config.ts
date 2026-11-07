import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    // e2e/ holds Playwright specs, not Vitest ones - they use an
    // incompatible test() signature and must run via `playwright test`.
    exclude: ["**/node_modules/**", "e2e/**"],
    // The default is one worker per CPU thread minus one (11 on a 12-thread
    // laptop). jsdom page tests are CPU-heavy, so that many at once starved
    // each other and tests hit the 5 s timeout. 4 workers is about as fast
    // here and leaves the laptop usable.
    maxWorkers: 4,
    minWorkers: 1,
  },
});
