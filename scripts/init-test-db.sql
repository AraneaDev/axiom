-- Creates the test database used by vitest.
-- Mounted into postgres via docker-entrypoint-initdb.d (runs once on first start).
CREATE DATABASE axiom_test OWNER axiom;
