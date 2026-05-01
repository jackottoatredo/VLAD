-- VLAD Supabase Schema
-- Run this in the Supabase SQL editor to create all required tables.
--
-- Merchants come from the external `previews` scrape table (same Supabase
-- project). `vlad_recordings.merchant_id` holds `previews.id` (uuid) as text
-- with no foreign key, since `previews` is owned by a separate service.

create table vlad_users (
  id          text primary key,        -- email address (e.g. jack.otto@redo.com)
  first_name  text not null,
  last_name   text not null default '',
  role        text not null default 'user' check (role in ('user', 'admin')),
  created_at  timestamptz default now()
);

create table vlad_recordings (
  id                uuid primary key default gen_random_uuid(),
  user_id           text references vlad_users(id) not null,
  type              text not null check (type in ('product', 'merchant')),
  name              text not null,
  product_name      text,
  merchant_id       text,
  mouse_events_url  text,
  webcam_url        text,
  preview_url       text,
  webcam_settings   jsonb,
  metadata          jsonb not null default '{}',
  status            text not null default 'saved' check (status in ('draft', 'saved')),
  created_at        timestamptz default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, name)
);

create table vlad_renders (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 text references vlad_users(id) not null,
  product_recording_id    uuid references vlad_recordings(id) on delete set null,
  merchant_recording_id   uuid references vlad_recordings(id) on delete set null,
  brand                   text,
  brand_name              text,
  brand_url               text,
  product_name            text,
  video_url               text,
  slug                    text,
  poster_key              text,
  poster_square_key       text,
  gif_key                 text,
  status                  text not null default 'pending' check (status in ('pending', 'rendering', 'done', 'error')),
  progress                int default 0,
  seen                    boolean not null default false,
  stale                   boolean not null default false,
  job_id                  text,
  job_request             jsonb,
  created_at              timestamptz default now()
);

create unique index vlad_renders_slug_unique
  on vlad_renders (slug)
  where slug is not null;

create index vlad_renders_job_id_idx
  on vlad_renders (job_id) where job_id is not null;

-- Generic append-only event log backing the admin usage and (future) share-page
-- engagement dashboards. No FKs on user_id / target_id — events outlive their
-- sources by design.
create table vlad_event_log (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  user_id     text,
  target_id   text,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index vlad_event_log_type_created_idx
  on vlad_event_log (type, created_at desc);

create index vlad_event_log_user_idx
  on vlad_event_log (user_id) where user_id is not null;

create index vlad_event_log_target_idx
  on vlad_event_log (target_id) where target_id is not null;

-- Append-only public-traffic engagement on /v/[slug] share pages. Separate
-- from vlad_event_log because the audience (anonymous, public) and schema
-- (network/UA fields, no user_id) differ. No FK on slug — events outlive
-- their source render.
-- Per-visitor profile. Stable attributes (geo, UA, device) live here so
-- they're set once per visitor and queried via JOIN from the events
-- table. Keyed on visitor_id (the per-browser localStorage identifier
-- generated client-side); null for bot visits which are tracked
-- separately on the events table.
create table vlad_engagement_visitors (
  visitor_id    text primary key,
  ip_hash       text not null,
  country       text,
  region        text,
  city          text,
  latitude      real,
  longitude     real,
  ua_family     text,
  device_type   text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index vlad_engagement_visitors_region_idx
  on vlad_engagement_visitors (region) where region is not null;

create index vlad_engagement_visitors_country_idx
  on vlad_engagement_visitors (country) where country is not null;

create index vlad_engagement_visitors_ip_hash_idx
  on vlad_engagement_visitors (ip_hash);

create table vlad_engagement_events (
  id            uuid primary key default gen_random_uuid(),
  type          text not null,
  slug          text not null,
  host          text,
  visitor_id    text references vlad_engagement_visitors (visitor_id) on delete set null deferrable initially deferred,
  ip_hash       text not null,
  is_bot        boolean not null default false,
  bot_kind      text,
  referrer_host text,
  referrer_kind text,
  payload       jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

create index vlad_engagement_slug_created_idx
  on vlad_engagement_events (slug, created_at desc);

create index vlad_engagement_type_created_idx
  on vlad_engagement_events (type, created_at desc);

create index vlad_engagement_humans_idx
  on vlad_engagement_events (created_at desc) where is_bot = false;

create index vlad_engagement_ip_recent_idx
  on vlad_engagement_events (ip_hash, created_at desc);
