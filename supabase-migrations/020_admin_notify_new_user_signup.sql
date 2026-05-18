-- Admin-only Slack DM stream: ping opted-in admins the first time a new user
-- signs into VLAD. Defaults to off — admins must opt in from
-- /tools/settings. The toggle is hidden in the UI and rejected by the API
-- for non-admins, but the column lives on every preferences row so the
-- query path stays uniform.

alter table vlad_user_preferences
  add column notify_new_user_signup boolean not null default false;
