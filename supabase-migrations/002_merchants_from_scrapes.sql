-- Merchants-from-scrapes: drop internal vlad_merchants table.
--
-- vlad_recordings.merchant_id now holds previews.id (uuid) for new recordings.
-- Existing slug-form merchant_id values are left in place; they become orphaned
-- but are harmless (the iframe brand param already uses website_url, not id).

alter table vlad_recordings drop constraint if exists vlad_recordings_merchant_id_fkey;
drop table if exists vlad_merchants;
