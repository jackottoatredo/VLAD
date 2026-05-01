-- ============================================================================
-- Migration 010: Share-page engagement events
-- ============================================================================
-- Append-only table for anonymous public engagement on /v/[slug] share pages.
-- Kept separate from vlad_event_log because the audiences are different:
-- vlad_event_log tracks authenticated internal users; this table tracks
-- anonymous public traffic. They have different schemas (no user_id, plus
-- network/UA fields), different volumes (public traffic is much higher),
-- and different retention concerns (PII via ip_hash). A combined table
-- would force every dashboard query to filter by event family.
--
-- No FKs on slug — events outlive their source render. Same precedent as
-- vlad_event_log (migration 009). If a render is deleted, its engagement
-- history remains for trend analysis.
--
-- No backfill — there's no historical engagement to reconstruct, since
-- nothing was logging visits before this migration. The table starts
-- empty by design.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS vlad_engagement_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text NOT NULL,                -- 'bot_visit' | 'human_visit' | 'video_play' | 'video_quartile' | 'video_end'
                                              -- | 'click_copy_link' | 'click_book_demo' | 'click_interactive_demo'
                                              -- | 'asset_download'
                                              -- (bot_visit/human_visit were renamed from visit/visit_linked in migration 015)
  slug          text NOT NULL,                -- share slug; every panel filters on it
  visitor_id    text,                         -- nullable; reserved for future cookie-based stable ID
  ip_hash       text NOT NULL,                -- HMAC-SHA256(ip, ENGAGEMENT_IP_SALT) truncated to 16 hex chars
  is_bot        boolean NOT NULL DEFAULT false,
  bot_kind      text,                         -- 'slackbot'|'linkedinbot'|'twitterbot'|'discordbot'|'facebookexternalhit'|'whatsapp'|'telegram'|'generic'|null
  ua_family     text,                         -- 'chrome'|'safari'|'mobile-safari'|'firefox'|'edge'|'other'
  country       text,                         -- ISO-3166 alpha-2; populated on `visit` events when not bot, via iplocate
  region        text,                         -- iplocate subdivision; nullable
  referrer_host text,                         -- raw referer hostname or null (direct)
  referrer_kind text,                         -- 'slack'|'linkedin'|'twitter'|'email'|'direct'|'other'
  payload       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Hot path: every per-share panel groups by (slug, day).
CREATE INDEX IF NOT EXISTS vlad_engagement_slug_created_idx
  ON vlad_engagement_events (slug, created_at DESC);

-- Type-keyed queries: funnel counts, click breakdowns.
CREATE INDEX IF NOT EXISTS vlad_engagement_type_created_idx
  ON vlad_engagement_events (type, created_at DESC);

-- Partial index for the dashboard's default "humans only" view.
CREATE INDEX IF NOT EXISTS vlad_engagement_humans_idx
  ON vlad_engagement_events (created_at DESC)
  WHERE is_bot = false;

-- Used by the per-IP rate limiter at write time and by the unique-visitors
-- query at read time.
CREATE INDEX IF NOT EXISTS vlad_engagement_ip_recent_idx
  ON vlad_engagement_events (ip_hash, created_at DESC);

COMMIT;

-- ============================================================================
-- Rollback (run only if you need to undo this migration)
-- ============================================================================
-- BEGIN;
--   DROP INDEX IF EXISTS vlad_engagement_ip_recent_idx;
--   DROP INDEX IF EXISTS vlad_engagement_humans_idx;
--   DROP INDEX IF EXISTS vlad_engagement_type_created_idx;
--   DROP INDEX IF EXISTS vlad_engagement_slug_created_idx;
--   DROP TABLE IF EXISTS vlad_engagement_events;
-- COMMIT;
