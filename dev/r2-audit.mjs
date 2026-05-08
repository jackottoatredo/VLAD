// One-off R2 bucket audit — lists every object, groups by top-level prefix
// and second-level prefix, and writes the full listing to dev/r2-listing.json
// for downstream filtering against the database.
//
// Usage: node --env-file=.env.local dev/r2-audit.mjs

import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { writeFile } from "node:fs/promises";

const BUCKET = process.env.S3_BUCKET;
if (!BUCKET) throw new Error("S3_BUCKET not set");

const client = new S3Client({
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

const all = [];
let continuationToken;
let pages = 0;
do {
  const res = await client.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }),
  );
  for (const obj of res.Contents ?? []) {
    all.push({
      key: obj.Key,
      size: obj.Size ?? 0,
      lastModified: obj.LastModified?.toISOString() ?? null,
    });
  }
  continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  pages++;
  if (pages % 10 === 0) console.error(`...listed ${all.length} so far`);
} while (continuationToken);

console.error(`Total objects: ${all.length}`);

// Group by top-level prefix (segment before first /).
const byTop = new Map();
const bySecond = new Map();
for (const obj of all) {
  const parts = obj.key.split("/");
  const top = parts.length > 1 ? parts[0] : "(root)";
  const second = parts.length > 2 ? `${parts[0]}/${parts[1]}` : top;
  const t = byTop.get(top) ?? { count: 0, bytes: 0 };
  t.count++;
  t.bytes += obj.size;
  byTop.set(top, t);
  const s = bySecond.get(second) ?? { count: 0, bytes: 0 };
  s.count++;
  s.bytes += obj.size;
  bySecond.set(second, s);
}

const fmtBytes = (n) => {
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n > 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n > 1e3) return `${(n / 1e3).toFixed(2)} KB`;
  return `${n} B`;
};

console.log("\n=== TOP-LEVEL PREFIXES ===");
const topRows = [...byTop.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
for (const [name, { count, bytes }] of topRows) {
  console.log(`  ${name.padEnd(24)} ${String(count).padStart(7)} objs   ${fmtBytes(bytes)}`);
}

console.log("\n=== SECOND-LEVEL PREFIXES (top 50 by size) ===");
const secondRows = [...bySecond.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 50);
for (const [name, { count, bytes }] of secondRows) {
  console.log(`  ${name.padEnd(60)} ${String(count).padStart(7)} objs   ${fmtBytes(bytes)}`);
}

// Distribution of file extensions / suffixes — useful for spotting legacy
// formats (e.g. .mov where we now produce .mp4, leftover .frames.bin, etc).
const byExt = new Map();
for (const obj of all) {
  const m = obj.key.match(/\.([a-z0-9]+(?:\.[a-z0-9]+)?)$/i);
  const ext = m ? m[1].toLowerCase() : "(none)";
  const e = byExt.get(ext) ?? { count: 0, bytes: 0 };
  e.count++;
  e.bytes += obj.size;
  byExt.set(ext, e);
}
console.log("\n=== FILE EXTENSIONS ===");
for (const [ext, { count, bytes }] of [...byExt.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`  ${ext.padEnd(20)} ${String(count).padStart(7)} objs   ${fmtBytes(bytes)}`);
}

// Age buckets — cleanup candidates are usually old.
const now = Date.now();
const ageBuckets = {
  "<7d": { count: 0, bytes: 0 },
  "7-30d": { count: 0, bytes: 0 },
  "30-90d": { count: 0, bytes: 0 },
  "90-180d": { count: 0, bytes: 0 },
  "180-365d": { count: 0, bytes: 0 },
  ">1y": { count: 0, bytes: 0 },
  unknown: { count: 0, bytes: 0 },
};
for (const obj of all) {
  if (!obj.lastModified) {
    ageBuckets.unknown.count++;
    ageBuckets.unknown.bytes += obj.size;
    continue;
  }
  const days = (now - new Date(obj.lastModified).getTime()) / 86_400_000;
  let bucket;
  if (days < 7) bucket = "<7d";
  else if (days < 30) bucket = "7-30d";
  else if (days < 90) bucket = "30-90d";
  else if (days < 180) bucket = "90-180d";
  else if (days < 365) bucket = "180-365d";
  else bucket = ">1y";
  ageBuckets[bucket].count++;
  ageBuckets[bucket].bytes += obj.size;
}
console.log("\n=== AGE DISTRIBUTION (by lastModified) ===");
for (const [age, { count, bytes }] of Object.entries(ageBuckets)) {
  console.log(`  ${age.padEnd(10)} ${String(count).padStart(7)} objs   ${fmtBytes(bytes)}`);
}

await writeFile("dev/r2-listing.json", JSON.stringify(all));
console.log(`\nFull listing written to dev/r2-listing.json (${all.length} keys)`);
