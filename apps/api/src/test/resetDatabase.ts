import { platformPrisma } from "../lib/prisma.js";

export async function resetDatabase() {
  const tables = await platformPrisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `;
  if (tables.length === 0) return;

  const tableList = tables.map((t) => `"${t.tablename}"`).join(", ");
  await platformPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
}
