// Full wipe of VLAD-owned data: every key under vlad/ in R2 + every row in
// the 8 vlad_* tables in Supabase. Other-app prefixes in the bucket
// (harvest/, screenshots/, images/, html/, raw-batches/, captures/) are
// NEVER touched — guarded by an explicit allowlist.
//
// Use this only for a full reset prior to a naming-convention refactor.
// Logs out every user (vlad_users wiped). Irreversible.
//
// Usage:
//   node --env-file=.env.local dev/r2-wipe-all.mjs           # dry-run
//   node --env-file=.env.local dev/r2-wipe-all.mjs --execute # nuke

import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

const EXECUTE = process.argv.includes("--execute");
const BUCKET = process.env.S3_BUCKET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!BUCKET || !SUPABASE_URL || !SUPABASE_KEY) throw new Error("env not set");

// Hard allowlist: ONLY this prefix is in scope for deletion. Anything outside
// it aborts the run.
const ALLOWED_R2_PREFIX = "vlad/";

// Order matters — children before parents to satisfy FK constraints.
// vlad_users at the bottom because every other table references it.
// Each entry pairs the table name with its primary-key column for the
// PostgREST `not.is.null` tautology that DELETE-without-filter requires.
const TABLE_ORDER = [
  ["vlad_engagement_events", "id"],
  ["vlad_engagement_visitors", "visitor_id"],
  ["vlad_render_notifications", "slug"],
  ["vlad_event_log", "id"],
  ["vlad_renders", "id"],
  ["vlad_recordings", "id"],
  ["vlad_user_preferences", "user_id"],
  ["vlad_users", "id"],
];

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});
const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "count=exact",
};

const fmt = (n) =>
  n > 1e9 ? (n / 1e9).toFixed(2) + " GB" : n > 1e6 ? (n / 1e6).toFixed(2) + " MB" : n > 1e3 ? (n / 1e3).toFixed(2) + " KB" : n + " B";

console.log(`\nVLAD full wipe — bucket: ${BUCKET}`);
console.log(EXECUTE ? "MODE: EXECUTE (irreversible)\n" : "MODE: DRY-RUN\n");

// ---- Step 1: list R2 keys under vlad/ ---------------------------------------

const r2Keys = [];
let bytes = 0;
let token;
do {
  const r = await s3.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: ALLOWED_R2_PREFIX,
      ContinuationToken: token,
      MaxKeys: 1000,
    }),
  );
  for (const o of r.Contents ?? []) {
    if (!o.Key.startsWith(ALLOWED_R2_PREFIX)) {
      console.error(`ABORT: bucket returned key '${o.Key}' outside allowed prefix '${ALLOWED_R2_PREFIX}'`);
      process.exit(1);
    }
    r2Keys.push(o.Key);
    bytes += o.Size ?? 0;
  }
  token = r.IsTruncated ? r.NextContinuationToken : undefined;
} while (token);
console.log(`Step 1 — R2 vlad/ keys: ${r2Keys.length} (${fmt(bytes)})`);

// ---- Step 2: count rows per table ------------------------------------------

console.log(`\nStep 2 — Supabase row counts:`);
const counts = {};
for (const [t] of TABLE_ORDER) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=count`, { headers: sbHeaders });
  if (!r.ok) {
    console.error(`  ${t}: count failed (${r.status})`);
    counts[t] = null;
    continue;
  }
  const total = Number(r.headers.get("content-range")?.split("/").pop() ?? 0);
  counts[t] = total;
  console.log(`  ${t.padEnd(28)} ${total} rows`);
}

if (!EXECUTE) {
  console.log("\nDry-run complete. Re-run with --execute to wipe.");
  process.exit(0);
}

// ---- Step 3: bulk-delete R2 ------------------------------------------------

console.log(`\nStep 3 — deleting ${r2Keys.length} R2 keys`);
const BATCH = 1000;
let deleted = 0;
for (let i = 0; i < r2Keys.length; i += BATCH) {
  const batch = r2Keys.slice(i, i + BATCH);
  const Objects = batch.map((Key) => ({ Key }));
  const res = await s3.send(
    new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects, Quiet: true } }),
  );
  const errs = res.Errors ?? [];
  deleted += batch.length - errs.length;
  console.log(`  batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(r2Keys.length / BATCH)} — sent ${batch.length}, errs ${errs.length}, total ${deleted}`);
  if (errs.length) for (const e of errs.slice(0, 5)) console.log("    " + e.Key + ": " + e.Code + " " + e.Message);
}

// ---- Step 4: truncate Supabase tables (in FK order) ------------------------

console.log(`\nStep 4 — wiping Supabase rows in FK-safe order`);
for (const [t, pk] of TABLE_ORDER) {
  // PostgREST DELETE without filter is rejected; use a tautology on the
  // table's primary key column. Each table picks its own PK shape (id /
  // user_id / visitor_id / slug).
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?${pk}=not.is.null`, {
    method: "DELETE",
    headers: sbHeaders,
  });
  if (!r.ok) {
    console.warn(`  ${t}: DELETE failed ${r.status} ${await r.text()}`);
    continue;
  }
  const remaining = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=count`, { headers: sbHeaders });
  const total = Number(remaining.headers.get("content-range")?.split("/").pop() ?? 0);
  console.log(`  ${t.padEnd(28)} now ${total} rows (was ${counts[t] ?? "?"})`);
}

console.log("\nWipe complete.");
