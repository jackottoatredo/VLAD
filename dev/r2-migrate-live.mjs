// Phase 2 migration: copy every live VLAD R2 object under vlad/, rewrite
// Supabase columns, flush the render cache, and drain the BullMQ jobs queue.
//
// Idempotent — re-running after a partial failure resumes safely:
//   - copies skip when the target already exists (HeadObject probe)
//   - DB updates use `not like 'vlad/%'` guards
//   - cache flush is naturally idempotent
//   - queue drain is idempotent
//
// Usage:
//   node --env-file=.env.local dev/r2-migrate-live.mjs            # dry-run
//   node --env-file=.env.local dev/r2-migrate-live.mjs --execute  # run

import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import Redis from "ioredis";
import { Queue } from "bullmq";

const EXECUTE = process.argv.includes("--execute");
const BUCKET = process.env.S3_BUCKET;
if (!BUCKET) throw new Error("S3_BUCKET not set");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Supabase env not set");

const VLAD_PREFIXES = ["sessions/", "merges/", "renders/", "recordings/", "trims/", "composites/", "users/"];
const VLAD = "vlad";

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

console.log(`\nPhase 2 R2 migration — bucket: ${BUCKET}`);
console.log(EXECUTE ? "MODE: EXECUTE\n" : "MODE: DRY-RUN (no writes / DB updates)\n");

// ---- Step 1: list every live object under unprefixed VLAD prefixes ----------

const sources = [];
for (const prefix of VLAD_PREFIXES) {
  let token;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const o of r.Contents ?? []) sources.push({ key: o.Key, size: o.Size ?? 0 });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
}

const totalBytes = sources.reduce((s, o) => s + o.size, 0);
console.log(`Step 1 — found ${sources.length} live objects to migrate (${fmt(totalBytes)})`);
const byPrefix = new Map();
for (const o of sources) {
  const top = o.key.split("/")[0];
  const cur = byPrefix.get(top) ?? { count: 0, bytes: 0 };
  cur.count++;
  cur.bytes += o.size;
  byPrefix.set(top, cur);
}
for (const [top, { count, bytes }] of byPrefix) console.log(`  ${top.padEnd(14)} ${String(count).padStart(5)} objs   ${fmt(bytes)}`);

// ---- Step 2: copy each source to its vlad/-prefixed twin --------------------

let copied = 0;
let skipped = 0;
let errors = 0;
const errorList = [];

const PARALLEL = 16;
let cursor = 0;

async function copyOne({ key }) {
  const target = `${VLAD}/${key}`;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: target }));
    skipped++;
    return;
  } catch {
    /* not present — copy below */
  }
  if (!EXECUTE) {
    copied++;
    return;
  }
  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        Key: target,
        CopySource: `/${BUCKET}/${encodeURIComponent(key).replace(/%2F/g, "/")}`,
      }),
    );
    copied++;
  } catch (e) {
    errors++;
    errorList.push(`${key} → ${target}: ${e.name} ${e.message}`);
  }
}

console.log(`\nStep 2 — copy to vlad/ (${EXECUTE ? "executing" : "dry-run"})`);
const workers = Array.from({ length: PARALLEL }, async () => {
  while (cursor < sources.length) {
    const i = cursor++;
    await copyOne(sources[i]);
    if (copied + skipped > 0 && (copied + skipped) % 25 === 0) {
      process.stdout.write(`  progress: copied=${copied} skipped=${skipped} errors=${errors}\r`);
    }
  }
});
await Promise.all(workers);
console.log(`  copied=${copied} skipped=${skipped} errors=${errors}`);
if (errorList.length) {
  console.log("  first 10 errors:");
  for (const e of errorList.slice(0, 10)) console.log("    " + e);
  if (errors > 0 && EXECUTE) {
    console.error("\nAborting before DB rewrite — copy errors must be resolved first.");
    process.exit(1);
  }
}

// ---- Step 3: rewrite Supabase columns ---------------------------------------

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function rewriteColumn(table, col) {
  // Filter: column is set, doesn't already start with vlad/.
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=id,${col}&${col}=not.is.null&${col}=not.like.vlad/%25`;
  const res = await fetch(url, { headers: sbHeaders });
  if (!res.ok) throw new Error(`${table}.${col}: GET ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  if (rows.length === 0) return { updated: 0, examined: 0 };

  if (!EXECUTE) {
    return { updated: 0, examined: rows.length };
  }

  let updated = 0;
  for (const row of rows) {
    const oldVal = row[col];
    if (typeof oldVal !== "string" || !oldVal) continue;
    if (oldVal.startsWith("vlad/")) continue;
    const newVal = `vlad/${oldVal}`;
    const patch = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${row.id}`, {
      method: "PATCH",
      headers: sbHeaders,
      body: JSON.stringify({ [col]: newVal }),
    });
    if (!patch.ok) {
      throw new Error(`${table}.${col} PATCH ${row.id}: ${patch.status} ${await patch.text()}`);
    }
    updated++;
  }
  return { updated, examined: rows.length };
}

console.log(`\nStep 3 — rewrite Supabase columns to prepend vlad/ (${EXECUTE ? "executing" : "dry-run"})`);

const COLUMNS = [
  ["vlad_recordings", "mouse_events_url"],
  ["vlad_recordings", "webcam_url"],
  ["vlad_recordings", "preview_url"],
  ["vlad_renders", "video_url"],
  ["vlad_renders", "poster_key"],
  ["vlad_renders", "poster_square_key"],
  ["vlad_renders", "gif_key"],
];

for (const [table, col] of COLUMNS) {
  const { updated, examined } = await rewriteColumn(table, col);
  console.log(`  ${(table + "." + col).padEnd(36)} examined=${examined} updated=${updated}`);
}

// ---- Step 4: flush render cache ---------------------------------------------

console.log(`\nStep 4 — flush Redis render cache (${EXECUTE ? "executing" : "dry-run"})`);

function buildRedisConnection() {
  if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    };
  }
  return {
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379),
    ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
    ...(process.env.REDIS_USERNAME ? { username: process.env.REDIS_USERNAME } : {}),
  };
}

const redis = new Redis(buildRedisConnection());
const cachePattern = "cache:v4:*";
const cacheKeysToDelete = [];
const stream = redis.scanStream({ match: cachePattern, count: 200 });
await new Promise((resolve, reject) => {
  stream.on("data", (batch) => {
    for (const k of batch) cacheKeysToDelete.push(k);
  });
  stream.on("end", resolve);
  stream.on("error", reject);
});
console.log(`  matched ${cacheKeysToDelete.length} keys under ${cachePattern}`);
if (EXECUTE && cacheKeysToDelete.length) {
  // ioredis caps DEL args around ~512K — chunk to be safe
  for (let i = 0; i < cacheKeysToDelete.length; i += 500) {
    const chunk = cacheKeysToDelete.slice(i, i + 500);
    await redis.del(...chunk);
  }
  console.log(`  deleted ${cacheKeysToDelete.length} cache keys`);
}

// ---- Step 5: drain BullMQ jobs queue ----------------------------------------

console.log(`\nStep 5 — drain BullMQ jobs queue (${EXECUTE ? "executing" : "dry-run"})`);
const jobsQueue = new Queue("jobs", { connection: buildRedisConnection() });
const counts = await jobsQueue.getJobCounts("waiting", "active", "delayed", "paused", "failed");
console.log("  current counts:", counts);
if (EXECUTE) {
  // drain(true) = also remove delayed jobs.
  await jobsQueue.drain(true);
  const after = await jobsQueue.getJobCounts("waiting", "active", "delayed", "paused", "failed");
  console.log("  after drain:    ", after);
}
await jobsQueue.close();
await redis.quit();

// ---- Done -------------------------------------------------------------------

console.log("\nMigration step complete.");
if (!EXECUTE) {
  console.log("Re-run with --execute to apply.");
}
