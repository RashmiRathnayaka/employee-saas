import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// vitest.config.ts runs with `globals: false`, so React Testing Library's
// own auto-cleanup (which looks for a *global* afterEach) never registers.
// Do it explicitly so each test's render() is unmounted before the next.
afterEach(() => cleanup());

// jsdom doesn't do layout, so it has no ResizeObserver. Radix's Checkbox needs
// the class to exist, but nothing in a test depends on real measurements.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
