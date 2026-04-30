-- ============================================================================
-- Migration 009: Generic Event Log
-- ============================================================================
-- Append-only event table backing the admin usage dashboard. Events outlive
-- the rows they reference (no FK on user_id / target_id) so stats survive
-- when source recordings or renders are deleted. The same table will host
-- share-page engagement events when that feature lands.
--
-- Backfill at the bottom synthesizes events from existing vlad_users,
-- vlad_recordings, and vlad_renders rows so the dashboard isn't empty on
-- first run. Historical render rows lack the timing instrumentation that
-- only new renders get, so renderDurationMs / videoLengthSec are null for
-- backfilled render_completed events — the dashboard treats them as "no
-- data" rather than zeros.
--
-- Idempotent — safe to re-run. The backfill blocks check whether any
-- events of each type exist before inserting.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS vlad_event_log (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  user_id     text,
  target_id   text,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS vlad_event_log_type_created_idx
  ON vlad_event_log (type, created_at desc);

CREATE INDEX IF NOT EXISTS vlad_event_log_user_idx
  ON vlad_event_log (user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vlad_event_log_target_idx
  ON vlad_event_log (target_id) WHERE target_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Backfill
-- ----------------------------------------------------------------------------

-- login: one per existing user, dated to their signup
INSERT INTO vlad_event_log (type, user_id, created_at)
SELECT 'login', id, created_at FROM vlad_users
WHERE NOT EXISTS (SELECT 1 FROM vlad_event_log WHERE type = 'login');

-- recording_created
INSERT INTO vlad_event_log (type, user_id, target_id, payload, created_at)
SELECT
  'recording_created',
  user_id,
  id::text,
  jsonb_build_object('kind', CASE WHEN type = 'merchant' THEN 'intro' ELSE 'product' END),
  created_at
FROM vlad_recordings
WHERE NOT EXISTS (SELECT 1 FROM vlad_event_log WHERE type = 'recording_created');

-- render_started + render_completed for done renders. Duration/length null
-- so the efficiency-ratio chart treats backfilled rows as no-data.
INSERT INTO vlad_event_log (type, user_id, target_id, payload, created_at)
SELECT 'render_started', user_id, id::text, '{}'::jsonb, created_at
FROM vlad_renders
WHERE status = 'done'
  AND NOT EXISTS (SELECT 1 FROM vlad_event_log WHERE type = 'render_started');

INSERT INTO vlad_event_log (type, user_id, target_id, payload, created_at)
SELECT
  'render_completed',
  user_id,
  id::text,
  jsonb_build_object('renderDurationMs', NULL, 'videoLengthSec', NULL),
  created_at
FROM vlad_renders
WHERE status = 'done'
  AND NOT EXISTS (SELECT 1 FROM vlad_event_log WHERE type = 'render_completed');

-- render_failed for error renders
INSERT INTO vlad_event_log (type, user_id, target_id, payload, created_at)
SELECT 'render_failed', user_id, id::text, '{}'::jsonb, created_at
FROM vlad_renders
WHERE status = 'error'
  AND NOT EXISTS (SELECT 1 FROM vlad_event_log WHERE type = 'render_failed');

-- user_active: one per user per day on which they did anything (union of
-- the timestamps from the events we just synthesized). Makes the DAU/WAU/MAU
-- charts meaningful from day one.
INSERT INTO vlad_event_log (type, user_id, created_at)
SELECT 'user_active', user_id, day::timestamptz
FROM (
  SELECT DISTINCT user_id, date_trunc('day', created_at) AS day
  FROM vlad_event_log
  WHERE user_id IS NOT NULL
) src
WHERE NOT EXISTS (SELECT 1 FROM vlad_event_log WHERE type = 'user_active');

COMMIT;

-- ============================================================================
-- Rollback (run only if you need to undo this migration)
-- ============================================================================
-- BEGIN;
--   DROP INDEX IF EXISTS vlad_event_log_target_idx;
--   DROP INDEX IF EXISTS vlad_event_log_user_idx;
--   DROP INDEX IF EXISTS vlad_event_log_type_created_idx;
--   DROP TABLE IF EXISTS vlad_event_log;
-- COMMIT;
