import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// vitest.config.ts runs with `globals: false`, so React Testing Library's
// own auto-cleanup (which looks for a *global* afterEach) never registers.
// Do it explicitly so each test's render() is unmounted before the next.
afterEach(() => cleanup());
