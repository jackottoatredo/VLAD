-- ============================================================================
-- Migration 014: Visitor profile refactor
-- ============================================================================
-- Splits per-visitor metadata (geo, UA, device) off of vlad_engagement_events
-- onto a new vlad_engagement_visitors table keyed by visitor_id. Events
-- reference the visitor via FK; geo/UA/device columns drop off events
-- entirely so they're never out-of-date or sparsely populated again.
--
-- Why: when geo lived on each event row, only `visit` rows had it filled
-- in (iplocate ran only on visit). Region filter would drop every other
-- event from the same Californian visitor because those rows had null
-- region. A visitor row solves this — JOIN events to visitors and the
-- filter cascades naturally.
--
-- iplocate enrichment moves from `visit` events to the visitor upsert
-- triggered by `visit_linked` (the first client beacon for any human).
-- Server-side `visit` events become bot-only. Humans always carry a
-- visitor_id from localStorage so every human event can be joined to a
-- visitor row.
--
-- Pre-release wipe: vlad_engagement_events is truncated. Acceptable
-- because there's no production data — only dev/test traffic.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- New: visitors table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vlad_engagement_visitors (
  visitor_id    text PRIMARY KEY,
  ip_hash       text NOT NULL,           -- latest seen; updated on every event
  country       text,                    -- ISO 3166-1 alpha-2
  region        text,                    -- iplocate subdivision
  city          text,
  latitude      real,
  longitude     real,
  ua_family     text,
  device_type   text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vlad_engagement_visitors_region_idx
  ON vlad_engagement_visitors (region) WHERE region IS NOT NULL;

CREATE INDEX IF NOT EXISTS vlad_engagement_visitors_country_idx
  ON vlad_engagement_visitors (country) WHERE country IS NOT NULL;

CREATE INDEX IF NOT EXISTS vlad_engagement_visitors_ip_hash_idx
  ON vlad_engagement_visitors (ip_hash);

-- ----------------------------------------------------------------------------
-- Wipe events (pre-release; no production data to preserve) and drop
-- columns that now live on the visitor row.
-- ----------------------------------------------------------------------------
TRUNCATE vlad_engagement_events;

ALTER TABLE vlad_engagement_events
  DROP COLUMN IF EXISTS country,
  DROP COLUMN IF EXISTS region,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS latitude,
  DROP COLUMN IF EXISTS longitude,
  DROP COLUMN IF EXISTS ua_family,
  DROP COLUMN IF EXISTS device_type;

-- ----------------------------------------------------------------------------
-- FK: events.visitor_id → visitors.visitor_id. Nullable because bot
-- `visit` events don't carry a visitor_id. ON DELETE SET NULL means
-- deleting a visitor anonymizes their events instead of cascading.
-- DEFERRABLE so a single transaction can insert event + visitor in
-- either order without violating the FK at the row level.
-- ----------------------------------------------------------------------------
ALTER TABLE vlad_engagement_events
  DROP CONSTRAINT IF EXISTS vlad_engagement_events_visitor_id_fkey;

ALTER TABLE vlad_engagement_events
  ADD CONSTRAINT vlad_engagement_events_visitor_id_fkey
    FOREIGN KEY (visitor_id) REFERENCES vlad_engagement_visitors (visitor_id)
    ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

COMMIT;

-- ============================================================================
-- Rollback
-- ============================================================================
-- BEGIN;
--   ALTER TABLE vlad_engagement_events
--     DROP CONSTRAINT IF EXISTS vlad_engagement_events_visitor_id_fkey;
--   ALTER TABLE vlad_engagement_events
--     ADD COLUMN IF NOT EXISTS country text,
--     ADD COLUMN IF NOT EXISTS region text,
--     ADD COLUMN IF NOT EXISTS city text,
--     ADD COLUMN IF NOT EXISTS latitude real,
--     ADD COLUMN IF NOT EXISTS longitude real,
--     ADD COLUMN IF NOT EXISTS ua_family text,
--     ADD COLUMN IF NOT EXISTS device_type text;
--   DROP INDEX IF EXISTS vlad_engagement_visitors_ip_hash_idx;
--   DROP INDEX IF EXISTS vlad_engagement_visitors_country_idx;
--   DROP INDEX IF EXISTS vlad_engagement_visitors_region_idx;
--   DROP TABLE IF EXISTS vlad_engagement_visitors;
-- COMMIT;
