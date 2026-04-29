-- ============================================================================
-- Migration 005: Demo Link Fields for Share Page
-- ============================================================================
-- Adds the two pieces the share page needs to construct a deep link to the
-- live interactive demo:
--   - vlad_renders.brand_url    (e.g. "mammut.com")
--   - vlad_renders.product_name (e.g. "Trion 28")
--
-- Both are URL fragments derived from the recording's metadata at render
-- time. The share page builds:
--   https://redo.com/search/brands/{brand_url}?product={product_name}
--
-- Both nullable so existing rows are unaffected — those fall back to the
-- stub href="#" on the share page.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE vlad_renders ADD COLUMN IF NOT EXISTS brand_url    text;
ALTER TABLE vlad_renders ADD COLUMN IF NOT EXISTS product_name text;

COMMIT;

-- ============================================================================
-- Rollback (run only if you need to undo this migration)
-- ============================================================================
-- BEGIN;
--   ALTER TABLE vlad_renders DROP COLUMN IF EXISTS product_name;
--   ALTER TABLE vlad_renders DROP COLUMN IF EXISTS brand_url;
-- COMMIT;
