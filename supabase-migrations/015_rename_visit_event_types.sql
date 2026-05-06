-- Rename event types for readability:
--   'visit'        -> 'bot_visit'      (server-side bot detection emit)
--   'visit_linked' -> 'human_visit'    (client beacon w/ visitor_id)
--
-- Pure rename; no schema change. Safe to run idempotently — the second
-- run is a no-op because the WHERE clauses match nothing.

UPDATE vlad_engagement_events
SET type = 'bot_visit'
WHERE type = 'visit';

UPDATE vlad_engagement_events
SET type = 'human_visit'
WHERE type = 'visit_linked';
