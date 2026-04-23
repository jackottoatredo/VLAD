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
  product_recording_id    uuid references vlad_recordings(id) on delete set null,
  merchant_recording_id   uuid references vlad_recordings(id) on delete set null,
  brand                   text,
  video_url               text,
  status                  text not null default 'pending' check (status in ('pending', 'rendering', 'done', 'error')),
  progress                int default 0,
  seen                    boolean not null default false,
  stale                   boolean not null default false,
  created_at              timestamptz default now()
);
