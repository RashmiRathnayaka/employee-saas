import argon2 from "argon2";
import { config } from "../config.js";

// argon2's library defaults (memoryCost 64 MiB, timeCost 3) are deliberately
// expensive - that's the point for real passwords. In tests, every
// createEmployeeWithLogin/createTestUser/reset-password call pays that cost
// on throwaway accounts, and under parallel test-runner load (web+api+mobile
// all competing for CPU) the cumulative hashing time was pushing
// argon2-heavy tests past vitest's 5s default timeout - which doesn't just
// fail that test, it leaves its in-flight transaction running in the
// background (vitest's timeout abandons the test, it doesn't cancel the
// Prisma call), colliding with the next test's TRUNCATE in setupDb.ts and
// surfacing as a Postgres deadlock on an unrelated test. Test security
// doesn't depend on hash strength, so only the cost is lowered here -
// argon2.verify() always reads the real cost back out of the hash string
// itself, so it doesn't need to know which parameters were used.
const TEST_HASH_OPTIONS = { memoryCost: 2 ** 12, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, config.NODE_ENV === "test" ? TEST_HASH_OPTIONS : undefined);
}
