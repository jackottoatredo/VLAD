-- ============================================================================
-- Migration 004: Square-letterboxed Poster for OG Cards
-- ============================================================================
-- Adds vlad_renders.poster_square_key, which holds the R2 key for a
-- 1200x1200 letterboxed poster image used as `og:image` on the share page.
--
-- Why a separate poster: iMessage / WhatsApp / Twitter render their preview
-- cards in a near-square layout that center-crops 16:9 images badly. A
-- letterboxed 1:1 asset fits every card layout cleanly. The original 16:9
-- poster.jpg is kept for the landing page's <video poster="..."> attribute,
-- where 16:9 is the right aspect.
--
-- Nullable so existing rows are unaffected; new renders backfill it.
-- ============================================================================

BEGIN;

ALTER TABLE vlad_renders ADD COLUMN IF NOT EXISTS poster_square_key text;

COMMIT;

-- ============================================================================
-- Rollback (run only if you need to undo this migration)
-- ============================================================================
-- BEGIN;
--   ALTER TABLE vlad_renders DROP COLUMN IF EXISTS poster_square_key;
-- COMMIT;
