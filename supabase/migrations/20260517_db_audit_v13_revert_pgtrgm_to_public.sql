-- ============================================================
-- DB Audit v13 — Revert pg_trgm to public schema
-- Moving pg_trgm to extensions broke ILIKE searches.
-- PostgreSQL's query planner resolves gin_trgm_ops from search_path;
-- with pg_trgm in extensions (not in default search_path="$user,public"),
-- ILIKE queries on GIN-indexed columns (products.nombre, principio_activo)
-- fail with "Bad Request" (PostgREST 400).
-- Reverted: security benefit was minimal, functionality is critical.
-- ============================================================
ALTER EXTENSION pg_trgm SET SCHEMA public;
