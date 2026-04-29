-- ============================================================================
-- Migration 006: Brand Display Name on Renders
-- ============================================================================
-- Adds vlad_renders.brand_name — the human-readable brand name (e.g. "And
-- Collar") sourced from previews.data.brandName at render time. Distinct from
-- vlad_renders.brand_url (the URL host, e.g. "and-collar.com") and from
-- vlad_renders.brand (a display label combining merchant + product names).
--
-- The share page prefers brand_name for its title; falls back to a derivation
-- from brand_url for old rows where brand_name is null.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE vlad_renders ADD COLUMN IF NOT EXISTS brand_name text;

COMMIT;

-- ============================================================================
-- Rollback (run only if you need to undo this migration)
-- ============================================================================
-- BEGIN;
--   ALTER TABLE vlad_renders DROP COLUMN IF EXISTS brand_name;
-- COMMIT;
