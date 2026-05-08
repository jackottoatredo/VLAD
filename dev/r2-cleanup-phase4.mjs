// Phase 4 cleanup: delete every unprefixed top-level VLAD object now that
// they've been copied under vlad/ and DB columns rewritten.
//
// Safety:
//   - Only touches keys directly under the 7 known-VLAD top-level prefixes.
//   - Hard reject if any key starts with a forbidden (other-app) prefix.
//   - HeadObject probe per-key — refuses to delete a source unless its
//     vlad/ twin exists in R2.
//
// Usage:
//   node --env-file=.env.local dev/r2-cleanup-phase4.mjs           # dry-run
//   node --env-file=.env.local dev/r2-cleanup-phase4.mjs --execute # delete

import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

const EXECUTE = process.argv.includes("--execute");
const BUCKET = process.env.S3_BUCKET;
if (!BUCKET) throw new Error("S3_BUCKET not set");

const VLAD_PREFIXES = ["sessions/", "merges/", "renders/", "recordings/", "trims/", "composites/", "users/"];
const FORBIDDEN_PREFIXES = ["harvest/", "screenshots/", "images/", "html/", "raw-batches/", "captures/", "vlad/"];

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

console.log(`\nPhase 4 unprefixed cleanup — bucket: ${BUCKET}`);
console.log(EXECUTE ? "MODE: EXECUTE (will delete)\n" : "MODE: DRY-RUN\n");

// ---- Step 1: list ----------------------------------------------------------

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

console.log(`Step 1 — found ${sources.length} unprefixed objects (${fmt(sources.reduce((s, o) => s + o.size, 0))})`);
const byPrefix = new Map();
for (const o of sources) {
  const top = o.key.split("/")[0];
  const cur = byPrefix.get(top) ?? { count: 0, bytes: 0 };
  cur.count++;
  cur.bytes += o.size;
  byPrefix.set(top, cur);
}
for (const [top, { count, bytes }] of byPrefix) console.log(`  ${top.padEnd(14)} ${String(count).padStart(5)} objs   ${fmt(bytes)}`);

// ---- Step 2: forbidden-prefix guard ----------------------------------------

for (const o of sources) {
  for (const f of FORBIDDEN_PREFIXES) {
    if (o.key.startsWith(f)) {
      console.error(`\nABORT: key '${o.key}' starts with forbidden prefix '${f}'.`);
      process.exit(1);
    }
  }
}

// ---- Step 3: twin-existence probe ------------------------------------------

console.log(`\nStep 2 — verify every source has a vlad/ twin (HeadObject probe)`);
const PARALLEL = 16;
let cursor = 0;
const missingTwins = [];
let probed = 0;

async function probeOne({ key }) {
  const target = `vlad/${key}`;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: target }));
  } catch {
    missingTwins.push(key);
  }
  probed++;
  if (probed % 25 === 0) process.stdout.write(`  probed ${probed}/${sources.length}\r`);
}

const probeWorkers = Array.from({ length: PARALLEL }, async () => {
  while (cursor < sources.length) {
    const i = cursor++;
    await probeOne(sources[i]);
  }
});
await Promise.all(probeWorkers);
console.log(`  probed ${probed}/${sources.length}, missing twins: ${missingTwins.length}`);
if (missingTwins.length > 0) {
  console.error("\nABORT: the following sources have no vlad/ twin — re-run dev/r2-migrate-live.mjs --execute first:");
  for (const k of missingTwins.slice(0, 20)) console.error("  " + k);
  process.exit(1);
}

// ---- Step 4: delete --------------------------------------------------------

if (!EXECUTE) {
  console.log("\nDry-run complete. Re-run with --execute to delete.");
  process.exit(0);
}

console.log(`\nStep 3 — bulk delete ${sources.length} unprefixed objects`);
const BATCH = 1000;
let deleted = 0;
let errored = 0;
const errs = [];
for (let i = 0; i < sources.length; i += BATCH) {
  const batch = sources.slice(i, i + BATCH);
  const Objects = batch.map(({ key }) => ({ Key: key }));
  const res = await s3.send(
    new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects, Quiet: true } }),
  );
  const e = res.Errors ?? [];
  errored += e.length;
  deleted += batch.length - e.length;
  for (const x of e) errs.push(`${x.Key}: ${x.Code} ${x.Message}`);
  console.log(`  batch ${i / BATCH + 1}/${Math.ceil(sources.length / BATCH)} — sent ${batch.length}, errs ${e.length}, total deleted ${deleted}`);
}

console.log(`\nDone. Deleted ${deleted}, errors ${errored}.`);
if (errs.length) {
  console.log("First 10 errors:");
  for (const x of errs.slice(0, 10)) console.log("  " + x);
}
