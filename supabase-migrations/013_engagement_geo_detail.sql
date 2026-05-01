-- ============================================================================
-- Migration 013: Capture city + lat/lng on engagement events
-- ============================================================================
-- Extends the geo data we keep per visit so the admin engagement map
-- can render city-level aggregated dots (US view) in addition to the
-- country-level choropleth (world view). iplocate already returns
-- city / latitude / longitude on every lookup; we just weren't storing
-- them.
--
-- Forward-only: existing rows have null for all three columns and won't
-- appear on the dot map. Country/region columns from migration 010 are
-- still populated for the country choropleth, so older rows still show
-- there.
--
-- Storage: real (single-precision float) is plenty for city centroid
-- coordinates — we don't need sub-meter accuracy and iplocate doesn't
-- claim any.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE vlad_engagement_events
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS latitude real,
  ADD COLUMN IF NOT EXISTS longitude real;

COMMIT;

-- ============================================================================
-- Rollback
-- ============================================================================
-- BEGIN;
--   ALTER TABLE vlad_engagement_events
--     DROP COLUMN IF EXISTS longitude,
--     DROP COLUMN IF EXISTS latitude,
--     DROP COLUMN IF EXISTS city;
-- COMMIT;
