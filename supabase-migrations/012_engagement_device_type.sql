-- ============================================================================
-- Migration 012: Add device_type column to vlad_engagement_events
-- ============================================================================
-- Orthogonal to ua_family. ua_family answers "which browser engine"
-- (chrome/safari/firefox/edge/other), device_type answers "what kind of
-- device" (mobile/tablet/desktop). A user on Chrome Android is captured
-- as ua_family='chrome', device_type='mobile'.
--
-- Nullable: rows logged before this migration have no device data;
-- bots have null device_type since classifying them is meaningless.
--
-- iPadOS 13+ defaults to "request desktop site" so Safari sends a macOS
-- UA. We will misclassify modern iPads as desktop. Documented limitation;
-- accept it for v1.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE vlad_engagement_events
  ADD COLUMN IF NOT EXISTS device_type text;

COMMIT;

-- ============================================================================
-- Rollback
-- ============================================================================
-- BEGIN;
--   ALTER TABLE vlad_engagement_events DROP COLUMN IF EXISTS device_type;
-- COMMIT;
