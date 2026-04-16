-- VLAD Supabase Schema
-- Run this in the Supabase SQL editor to create all required tables.
--
-- FRESH START: if migrating from the old name-based user system,
-- drop the old tables first:
--   DROP TABLE IF EXISTS vlad_renders CASCADE;
--   DROP TABLE IF EXISTS vlad_recordings CASCADE;
--   DROP TABLE IF EXISTS vlad_users CASCADE;

create table vlad_users (
  id          text primary key,        -- email address (e.g. jack.otto@redo.com)
  first_name  text not null,
  last_name   text not null default '',
  created_at  timestamptz default now()
);

create table vlad_merchants (
  id          text primary key,
  name        text not null,
  url         text not null,
  created_at  timestamptz default now()
);

create table vlad_recordings (
  id                uuid primary key default gen_random_uuid(),
  user_id           text references vlad_users(id) not null,
  type              text not null check (type in ('product', 'merchant')),
  product_name      text,
  merchant_id       text references vlad_merchants(id),
  mouse_events_url  text not null,
  webcam_url        text,
  preview_url       text,
  metadata          jsonb not null default '{}',
  status            text not null default 'saved' check (status in ('saved')),
  created_at        timestamptz default now()
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
  created_at              timestamptz default now()
);


