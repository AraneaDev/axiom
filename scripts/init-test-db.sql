-- Creates test databases used by vitest and Playwright E2E.
-- Mounted into postgres via docker-entrypoint-initdb.d (runs once on first start).
CREATE DATABASE axiom_test OWNER axiom;
CREATE DATABASE axiom_e2e OWNER axiom;
