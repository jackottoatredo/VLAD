-- ============================================================================
-- Migration 008: User Roles
-- ============================================================================
-- Adds vlad_users.role — 'user' (default) or 'admin'. Admins see extra pages
-- for managing other users' recordings and viewing usage / share-page
-- engagement statistics. Promotion to admin is done manually in the DB; the
-- app reads role at sign-in into the NextAuth JWT, so a promoted user must
-- sign out and back in for the change to take effect.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE vlad_users
  ADD COLUMN IF NOT EXISTS role text not null default 'user'
    check (role in ('user', 'admin'));

COMMIT;

-- ============================================================================
-- Rollback (run only if you need to undo this migration)
-- ============================================================================
-- BEGIN;
--   ALTER TABLE vlad_users DROP COLUMN IF EXISTS role;
-- COMMIT;
