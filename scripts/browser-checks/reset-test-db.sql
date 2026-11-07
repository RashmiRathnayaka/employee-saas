-- Empties the TEST database, keeping its migrations. Only run by
-- `node scripts/browser-check.mjs start --reset`, which first checks that .env.test
-- points at a *_test database.
DO $$
DECLARE
  tables text;
BEGIN
  SELECT string_agg(format('%I', tablename), ', ') INTO tables
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
  EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY CASCADE';
END $$;
