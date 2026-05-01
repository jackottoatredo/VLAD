-- Persist a canonical, slugified merchant-name on intro (merchant) recordings
-- so downstream code (slug + brand assembly, share-page title) can rely on a
-- stable identifier instead of round-tripping through `previews` on every
-- read. Falls back to deriveMerchantNameFromUrl(metadata.merchantUrl) at
-- read time for legacy rows where this column is NULL.

alter table vlad_recordings
  add column merchant_name text;
