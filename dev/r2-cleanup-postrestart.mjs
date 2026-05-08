// Post-restart cleanup: remove stray R2 objects + broken DB rows that the
// pre-restart worker wrote before deploy/restart. The worker had stale code
// without VLAD_NAMESPACE in scope, so the API routes wrote keys with the
// literal "undefined/" prefix and the worker wrote keys with NO prefix at
// all (bare composites/, trims/, renders/).
//
// Idempotent: re-running is safe.
//
// Usage:
//   node --env-file=.env.local dev/r2-cleanup-postrestart.mjs           # dry-run
//   node --env-file=.env.local dev/r2-cleanup-postrestart.mjs --execute # delete

import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const EXECUTE = process.argv.includes("--execute");

const BUCKET = process.env.S3_BUCKET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!BUCKET || !SUPABASE_URL || !SUPABASE_KEY) throw new Error("env not set");

// Prefixes the broken pre-restart writes used. None of these may legitimately
// exist post-migration — every legitimate VLAD object now lives under vlad/.
const STRAY_PREFIXES = ["undefined/", "composites/", "trims/", "renders/"];
const FORBIDDEN_PREFIXES = ["harvest/", "screenshots/", "images/", "html/", "raw-batches/", "captures/", "vlad/"];

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});
const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  Prefer: "return=representation",
};

const fmt = (n) => (n > 1e6 ? (n / 1e6).toFixed(2) + " MB" : n > 1e3 ? (n / 1e3).toFixed(2) + " KB" : n + " B");

console.log(`\nPost-restart cleanup — bucket: ${BUCKET}`);
console.log(EXECUTE ? "MODE: EXECUTE\n" : "MODE: DRY-RUN\n");

// ---- Step 1: list stray R2 objects ----------------------------------------

const stray = [];
for (const prefix of STRAY_PREFIXES) {
  let token;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of r.Contents ?? []) stray.push({ key: o.Key, size: o.Size ?? 0 });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
}
console.log(`Step 1 — stray R2 objects: ${stray.length} (${fmt(stray.reduce((s, o) => s + o.size, 0))})`);
const byTop = new Map();
for (const o of stray) {
  const top = o.key.split("/")[0] + "/";
  const cur = byTop.get(top) ?? { count: 0, bytes: 0 };
  cur.count++;
  cur.bytes += o.size;
  byTop.set(top, cur);
}
for (const [top, { count, bytes }] of byTop) console.log(`  ${top.padEnd(14)} ${String(count).padStart(4)} objs   ${fmt(bytes)}`);

// Forbidden-prefix guard
for (const o of stray) {
  for (const f of FORBIDDEN_PREFIXES) {
    if (o.key.startsWith(f)) {
      console.error(`\nABORT: key '${o.key}' starts with forbidden prefix '${f}'.`);
      process.exit(1);
    }
  }
}

// ---- Step 2: identify broken DB rows --------------------------------------

async function fetchBroken(table, keyCols, extraSelect) {
  // OR-filter across cols: any column that's set and doesn't start with vlad/.
  const filters = keyCols
    .map((c) => `and(${c}.not.is.null,${c}.not.like.vlad/%25)`)
    .join(",");
  const select = [...keyCols, ...extraSelect, "id"].join(",");
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}&or=(${filters})`;
  const res = await fetch(url, { headers: sbHeaders });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

const brokenRecordings = await fetchBroken(
  "vlad_recordings",
  ["mouse_events_url", "webcam_url", "preview_url"],
  ["name", "status"],
);
const brokenRenders = await fetchBroken(
  "vlad_renders",
  ["video_url", "poster_key", "poster_square_key", "gif_key"],
  ["brand", "status", "stale"],
);

console.log(`\nStep 2 — broken DB rows:`);
console.log(`  vlad_recordings: ${brokenRecordings.length}`);
for (const r of brokenRecordings) {
  console.log(`    ${r.id}  name=${r.name}  status=${r.status}`);
  console.log(`      mouse_events_url:  ${r.mouse_events_url}`);
  console.log(`      webcam_url:        ${r.webcam_url}`);
  console.log(`      preview_url:       ${r.preview_url}`);
}
console.log(`  vlad_renders: ${brokenRenders.length}`);
for (const r of brokenRenders) {
  console.log(`    ${r.id}  brand=${r.brand}  status=${r.status}  stale=${r.stale}`);
  console.log(`      video_url:         ${r.video_url}`);
  console.log(`      poster_key:        ${r.poster_key}`);
}

if (!EXECUTE) {
  console.log("\nDry-run complete. Re-run with --execute to act.");
  process.exit(0);
}

// ---- Step 3: delete R2 objects --------------------------------------------

console.log(`\nStep 3 — deleting ${stray.length} R2 objects`);
const BATCH = 1000;
let deleted = 0;
for (let i = 0; i < stray.length; i += BATCH) {
  const batch = stray.slice(i, i + BATCH);
  const Objects = batch.map(({ key }) => ({ Key: key }));
  const res = await s3.send(
    new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects, Quiet: true } }),
  );
  const errs = res.Errors ?? [];
  deleted += batch.length - errs.length;
  console.log(`  batch ${Math.floor(i / BATCH) + 1}: sent ${batch.length}, errs ${errs.length}, total ${deleted}`);
  if (errs.length) for (const e of errs.slice(0, 5)) console.log("    " + e.Key + ": " + e.Code + " " + e.Message);
}

// ---- Step 4: delete broken DB rows ----------------------------------------

async function delRow(table, id) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "DELETE",
    headers: sbHeaders,
  });
  if (!r.ok) throw new Error(`${table} delete ${id}: ${r.status} ${await r.text()}`);
}

console.log(`\nStep 4 — deleting ${brokenRecordings.length + brokenRenders.length} broken DB rows`);
for (const r of brokenRecordings) {
  await delRow("vlad_recordings", r.id);
  console.log(`  vlad_recordings ${r.id} deleted`);
}
for (const r of brokenRenders) {
  await delRow("vlad_renders", r.id);
  console.log(`  vlad_renders ${r.id} deleted`);
}

console.log("\nDone.");
