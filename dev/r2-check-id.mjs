// Inspect R2 + Supabase state for a given id (recordingId, renderId, or
// userId fragment). Used during Phase 5 manual testing to confirm cleanup
// hooks are actually wiping data.
//
// Usage:
//   node --env-file=.env.local dev/r2-check-id.mjs <id-or-substring>
//
// The id is matched as a substring against R2 keys AND against vlad_recordings,
// vlad_renders rows (id columns + key columns). Pass an email like
// "jack.otto@redo.com" to scope per-user; pass a UUID to inspect one record.

import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node dev/r2-check-id.mjs <id-or-substring>");
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) throw new Error("Supabase env not set");
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

const fmt = (n) =>
  n > 1e9 ? (n / 1e9).toFixed(2) + " GB" : n > 1e6 ? (n / 1e6).toFixed(2) + " MB" : n > 1e3 ? (n / 1e3).toFixed(2) + " KB" : n + " B";

console.log(`\n=== R2 (vlad/) keys containing "${arg}" ===`);
const matched = [];
let token;
do {
  const r = await s3.send(
    new ListObjectsV2Command({
      Bucket: process.env.S3_BUCKET,
      Prefix: "vlad/",
      ContinuationToken: token,
      MaxKeys: 1000,
    }),
  );
  for (const o of r.Contents ?? []) {
    if (o.Key.includes(arg)) matched.push({ key: o.Key, size: o.Size ?? 0 });
  }
  token = r.IsTruncated ? r.NextContinuationToken : undefined;
} while (token);

if (matched.length === 0) {
  console.log("  (none)");
} else {
  for (const o of matched) console.log(`  ${o.key.padEnd(120)} ${fmt(o.size)}`);
  console.log(`  total: ${matched.length} objs, ${fmt(matched.reduce((s, o) => s + o.size, 0))}`);
}

console.log(`\n=== Supabase rows ===`);

const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(arg);
const looksLikeEmail = arg.includes("@");

async function show(label, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, { headers });
  if (!r.ok) {
    console.log(`  ${label}: query failed ${r.status}`);
    return;
  }
  const rows = await r.json();
  console.log(`  ${label}: ${rows.length} row(s)`);
  for (const row of rows) {
    console.log(`    ${JSON.stringify(row)}`);
  }
}

if (isUuid) {
  await show(
    "vlad_recordings (by id)",
    `vlad_recordings?select=id,user_id,name,status,mouse_events_url,webcam_url,preview_url&id=eq.${arg}`,
  );
  await show(
    "vlad_renders (by id)",
    `vlad_renders?select=id,user_id,brand,status,stale,video_url,poster_key,poster_square_key,gif_key&id=eq.${arg}`,
  );
  await show(
    "vlad_renders (by product_recording_id)",
    `vlad_renders?select=id,brand,status,stale,video_url&product_recording_id=eq.${arg}`,
  );
  await show(
    "vlad_renders (by merchant_recording_id)",
    `vlad_renders?select=id,brand,status,stale,video_url&merchant_recording_id=eq.${arg}`,
  );
} else if (looksLikeEmail) {
  await show(
    "vlad_recordings (by user_id)",
    `vlad_recordings?select=id,name,status&user_id=eq.${encodeURIComponent(arg)}`,
  );
  await show(
    "vlad_renders (by user_id)",
    `vlad_renders?select=id,brand,status,stale&user_id=eq.${encodeURIComponent(arg)}`,
  );
} else {
  console.log(`  (unrecognized id shape — pass UUID or email-like string)`);
}
