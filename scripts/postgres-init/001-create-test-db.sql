-- Runs only on first container init (fresh volume). For an existing
-- volume that predates this file, create the test DB manually once:
--   docker compose exec postgres psql -U employee_saas -d employee_saas \
--     -c "CREATE DATABASE employee_saas_test OWNER employee_saas"
SELECT 'CREATE DATABASE employee_saas_test OWNER employee_saas'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'employee_saas_test')
\gexec
