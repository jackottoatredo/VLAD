-- Flip the three notification opt-ins to default on so new reps start
-- receiving per-render pings and digests without having to visit the
-- settings page. Existing rows are left alone — anyone already opted out
-- stays opted out.

alter table vlad_user_preferences
  alter column notify_visit set default true,
  alter column notify_daily_digest set default true,
  alter column notify_weekly_digest set default true;
