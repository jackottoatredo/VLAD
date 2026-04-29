-- ============================================================================
-- Migration 007: Render Job Tracking
-- ============================================================================
-- Adds two columns to vlad_renders so in-progress renders survive page reloads:
--
--   job_id       — BullMQ job id for the render. The UI uses this to resume
--                  polling /api/jobs/:jobId after a refresh. Null on rows
--                  created before this migration and on cache-hit rows that
--                  never enqueued a job.
--   job_request  — Original POST body that started the job, including the
--                  endpoint it was sent to. Lets the Retry button re-issue
--                  the exact same request without per-preset dispatch logic
--                  in the UI.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE vlad_renders ADD COLUMN IF NOT EXISTS job_id text;
ALTER TABLE vlad_renders ADD COLUMN IF NOT EXISTS job_request jsonb;

CREATE INDEX IF NOT EXISTS vlad_renders_job_id_idx
  ON vlad_renders (job_id) WHERE job_id IS NOT NULL;

COMMIT;

-- ============================================================================
-- Rollback (run only if you need to undo this migration)
-- ============================================================================
-- BEGIN;
--   DROP INDEX IF EXISTS vlad_renders_job_id_idx;
--   ALTER TABLE vlad_renders DROP COLUMN IF EXISTS job_request;
--   ALTER TABLE vlad_renders DROP COLUMN IF EXISTS job_id;
-- COMMIT;
