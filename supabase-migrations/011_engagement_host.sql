-- ============================================================================
-- Migration 011: Add host column to vlad_engagement_events
-- ============================================================================
-- Captures the request `Host` header so dashboards can split traffic by
-- environment (localhost / vlad-app-staged / vlad-production / future
-- domains) and surface anomalies when hosting changes. Top-level column
-- because we'll filter on it directly — same reasoning as `slug`.
--
-- Nullable: rows logged before this migration have no host data. The
-- dashboard should treat null as "unknown" and not assume any environment.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE vlad_engagement_events
  ADD COLUMN IF NOT EXISTS host text;

-- No index for now; cardinality is tiny (a handful of distinct hosts) and
-- dashboard filters always combine with slug or created_at, both of which
-- already have indexes.

COMMIT;

-- ============================================================================
-- Rollback
-- ============================================================================
-- BEGIN;
--   ALTER TABLE vlad_engagement_events DROP COLUMN IF EXISTS host;
-- COMMIT;
