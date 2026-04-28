-- ============================================================================
-- Migration 001: Stateful Flow Sessions
-- ============================================================================
-- Adds fields and constraints required by the flows-as-sessions rewrite:
--   - vlad_recordings.status accepts 'draft' in addition to 'saved'
--   - vlad_recordings.name (unique per user)
--   - vlad_recordings.webcam_settings (jsonb)
--   - vlad_recordings.updated_at (timestamptz)
--   - vlad_recordings.mouse_events_url relaxed to nullable
--   - vlad_renders.stale (boolean, for edit-invalidated merges)
--
-- Idempotent — safe to re-run. Wrap in a transaction so a partial failure
-- doesn't leave the schema half-migrated.
-- ============================================================================

BEGIN;

-- -- Phase 1: Add new columns (no-op if they already exist) -------------------

ALTER TABLE vlad_recordings ADD COLUMN IF NOT EXISTS name            text;
ALTER TABLE vlad_recordings ADD COLUMN IF NOT EXISTS webcam_settings jsonb;
ALTER TABLE vlad_recordings ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now();

ALTER TABLE vlad_renders    ADD COLUMN IF NOT EXISTS stale           boolean     NOT NULL DEFAULT false;

-- -- Phase 2: Backfill `name` for existing rows -----------------------------
-- Use product_name / merchant_id when present, else fall back to the row id.

UPDATE vlad_recordings
SET    name = COALESCE(product_name, merchant_id, id::text)
WHERE  name IS NULL;

-- Dedupe if the backfill produced any (user_id, name) collisions
-- (e.g. multiple saves for the same product under one presenter).
-- Keep the earliest row's name as-is; suffix later ones with an id shard.
WITH dupes AS (
  SELECT id,
         row_number() OVER (PARTITION BY user_id, name ORDER BY created_at, id) AS rn
  FROM   vlad_recordings
)
UPDATE vlad_recordings r
SET    name = r.name || '-' || substring(r.id::text FROM 1 FOR 8)
FROM   dupes
WHERE  r.id = dupes.id
  AND  dupes.rn > 1;

ALTER TABLE vlad_recordings ALTER COLUMN name SET NOT NULL;

-- -- Phase 3: Unique (user_id, name) constraint -----------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vlad_recordings_user_name_unique'
  ) THEN
    ALTER TABLE vlad_recordings
      ADD CONSTRAINT vlad_recordings_user_name_unique UNIQUE (user_id, name);
  END IF;
END $$;

-- -- Phase 4: Relax mouse_events_url NOT NULL -------------------------------

ALTER TABLE vlad_recordings ALTER COLUMN mouse_events_url DROP NOT NULL;

-- -- Phase 5: Update `status` check constraint ------------------------------

ALTER TABLE vlad_recordings DROP CONSTRAINT IF EXISTS vlad_recordings_status_check;
ALTER TABLE vlad_recordings
  ADD CONSTRAINT vlad_recordings_status_check CHECK (status IN ('draft', 'saved'));

COMMIT;

-- ============================================================================
-- Rollback (run only if you need to undo this migration)
-- ============================================================================
-- BEGIN;
--   ALTER TABLE vlad_recordings DROP CONSTRAINT IF EXISTS vlad_recordings_status_check;
--   ALTER TABLE vlad_recordings ADD CONSTRAINT vlad_recordings_status_check CHECK (status IN ('saved'));
--   ALTER TABLE vlad_recordings ALTER COLUMN mouse_events_url SET NOT NULL;
--   ALTER TABLE vlad_recordings DROP CONSTRAINT IF EXISTS vlad_recordings_user_name_unique;
--   ALTER TABLE vlad_recordings DROP COLUMN IF EXISTS name;
--   ALTER TABLE vlad_recordings DROP COLUMN IF EXISTS webcam_settings;
--   ALTER TABLE vlad_recordings DROP COLUMN IF EXISTS updated_at;
--   ALTER TABLE vlad_renders    DROP COLUMN IF EXISTS stale;
-- COMMIT;
