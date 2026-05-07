-- Move per-user preferences out of vlad_users into a dedicated
-- vlad_user_preferences table. Booking-link columns migrate over and pick up
-- new notification toggles (live visit ping, 5-min visit summary, daily and
-- weekly digests). slack_user_id is cached on first DM/invite so we don't
-- re-hit users.lookupByEmail on every event.

create table vlad_user_preferences (
  user_id                       text primary key
                                  references vlad_users(id) on delete cascade,

  -- Booking columns (migrated from vlad_users)
  hubspot_user_id               text,
  hubspot_meeting_id            text,
  hubspot_meeting_link          text,
  hubspot_meeting_name          text,
  book_button_mode              text not null default 'website_form'
    check (book_button_mode in ('website_form', 'hidden', 'hubspot')),

  -- Notification opt-ins. All default off.
  -- notify_visit gates the per-render Slack DM that grows in place via
  -- chat.update as engagement events accumulate (one message per render,
  -- not per visit). The daily/weekly toggles gate the cross-render
  -- summaries.
  notify_visit                  boolean not null default false,
  notify_daily_digest           boolean not null default false,
  notify_weekly_digest          boolean not null default false,

  -- Cached on first successful Slack lookup so we skip users.lookupByEmail
  -- on every event-driven DM.
  slack_user_id                 text,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

insert into vlad_user_preferences (
  user_id,
  hubspot_user_id, hubspot_meeting_id, hubspot_meeting_link, hubspot_meeting_name,
  book_button_mode
)
select
  id,
  hubspot_user_id, hubspot_meeting_id, hubspot_meeting_link, hubspot_meeting_name,
  book_button_mode
from vlad_users;

alter table vlad_users
  drop column hubspot_user_id,
  drop column hubspot_meeting_id,
  drop column hubspot_meeting_link,
  drop column hubspot_meeting_name,
  drop column book_button_mode;
