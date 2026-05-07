-- One row per render that has a live Slack engagement-stats DM. The DM is
-- created on the first non-internal, non-bot engagement event (any of:
-- human_visit, video_play, asset_download, click_copy_link, click_book_demo,
-- click_interactive_demo). Subsequent events for the same slug edit the
-- message in place via chat.update so the rep sees a single, growing
-- "Engagement Stats for X" line in their DMs.
--
-- We don't denormalize counters here — they're cheap to recompute from
-- vlad_engagement_events GROUP BY type at update time, and a GROUP BY query
-- can't drift from the source events. Revisit if a render's event count
-- grows past a few thousand and the recompute becomes hot.
--
-- No FK on slug → vlad_renders(slug). vlad_renders has only a partial
-- unique index (where slug is not null), which can't back an FK reference.
-- Orphaned rows after a render delete are harmless (Slack message stays).

create table vlad_render_notifications (
  slug            text primary key,
  rep_email       text not null,
  -- Slack channel ID for the DM — equal to the rep's Slack user ID,
  -- captured at the time the message was first posted. Cached so we don't
  -- re-resolve via users.lookupByEmail on every event.
  slack_channel   text not null,
  -- chat.postMessage `ts` of the message we keep editing.
  slack_ts        text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
