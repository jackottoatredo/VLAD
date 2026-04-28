-- ============================================================================
-- Migration 003: Share Links + Poster + GIF Preview for Renders
-- ============================================================================
-- Adds the columns that back the new share-link flow:
--   - vlad_renders.slug        (human-readable, unique-when-set share key)
--   - vlad_renders.poster_key  (R2 key for the frame-5 poster image)
--   - vlad_renders.gif_key     (R2 key for the short animated preview)
--
-- All three are nullable so existing rows are unaffected; the new flow only
-- lights up for renders produced after this migration runs. Slug uniqueness
-- is enforced by a partial unique index so multiple NULLs coexist while any
-- non-null slug is globally unique.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE vlad_renders ADD COLUMN IF NOT EXISTS slug       text;
ALTER TABLE vlad_renders ADD COLUMN IF NOT EXISTS poster_key text;
ALTER TABLE vlad_renders ADD COLUMN IF NOT EXISTS gif_key    text;

CREATE UNIQUE INDEX IF NOT EXISTS vlad_renders_slug_unique
  ON vlad_renders (slug)
  WHERE slug IS NOT NULL;

COMMIT;

-- ============================================================================
-- Rollback (run only if you need to undo this migration)
-- ============================================================================
-- BEGIN;
--   DROP INDEX IF EXISTS vlad_renders_slug_unique;
--   ALTER TABLE vlad_renders DROP COLUMN IF EXISTS gif_key;
--   ALTER TABLE vlad_renders DROP COLUMN IF EXISTS poster_key;
--   ALTER TABLE vlad_renders DROP COLUMN IF EXISTS slug;
-- COMMIT;
