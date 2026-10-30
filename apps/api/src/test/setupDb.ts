import { afterAll, beforeEach } from "vitest";
import { platformPrisma } from "../lib/prisma.js";
import { resetDatabase } from "./resetDatabase.js";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await platformPrisma.$disconnect();
});
