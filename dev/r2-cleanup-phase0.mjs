// Phase 0 R2 orphan cleanup. Reads dev/r2-orphans.json (per-category orphan
// keys produced by dev/r2-orphans.mjs against the live Supabase) and deletes
// them in batches of 1000.
//
// Defaults to dry-run. Pass --execute to actually delete.
//
// Hard guards:
//   - Only categories present in ALLOWED_CATEGORIES are touched.
//   - Any key starting with a non-VLAD prefix aborts the run (other apps
//     share this bucket — we never touch their data).
//
// Usage:
//   node --env-file=.env.local dev/r2-cleanup-phase0.mjs           # dry-run
//   node --env-file=.env.local dev/r2-cleanup-phase0.mjs --execute # delete

import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const EXECUTE = process.argv.includes("--execute");
const ORPHANS_PATH = "dev/r2-orphans.json";
const LISTING_PATH = "dev/r2-listing.json";

const ALLOWED_CATEGORIES = new Set([
  "sessions (no recording row)",
  "sessions (saved row, but session orig kept)",
  "recordings/{id}/ legacy mouse+webcam",
  "recordings/{id}/preview.mp4 (no row)",
  "renders (not referenced by any render row)",
  "merges (not referenced by any render row)",
  "composites (intermediate, never DB-referenced)",
  "trims (intermediate, never DB-referenced)",
  "users/ (legacy render path)",
  "(root) test artifact",
]);

// VLAD-owned sub-prefixes under the vlad/ namespace. Every legitimate VLAD
// key now lives at `vlad/<sub>/...` post-migration. Any orphan key not under
// one of these is rejected — defends against accidental deletion of other-app
// data sharing this bucket.
const VLAD_SUBPREFIXES = new Set([
  "sessions",
  "recordings",
  "renders",
  "merges",
  "composites",
  "trims",
  "users",
]);

const FORBIDDEN_PREFIXES = ["harvest/", "screenshots/", "images/", "html/", "raw-batches/", "captures/"];

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

// ---- Load + validate ------------------------------------------------------

const orphans = JSON.parse(readFileSync(ORPHANS_PATH, "utf8"));

// Optional: reload sizes from the listing for nicer reporting.
let sizeByKey = new Map();
try {
  const listing = JSON.parse(readFileSync(LISTING_PATH, "utf8"));
  for (const o of listing) sizeByKey.set(o.key, o.size);
} catch {
  console.error(`(could not read ${LISTING_PATH} — size totals will be omitted)`);
}

const fmt = (n) =>
  n > 1e9 ? (n / 1e9).toFixed(2) + " GB" : n > 1e6 ? (n / 1e6).toFixed(2) + " MB" : n > 1e3 ? (n / 1e3).toFixed(2) + " KB" : n + " B";

const unknownCategories = Object.keys(orphans).filter((c) => !ALLOWED_CATEGORIES.has(c));
if (unknownCategories.length > 0) {
  console.error(`Refusing to run: unknown categories in ${ORPHANS_PATH}:`);
  for (const c of unknownCategories) console.error(`  - ${c}`);
  process.exit(1);
}

const allKeys = [];
for (const [cat, keys] of Object.entries(orphans)) {
  for (const key of keys) {
    if (FORBIDDEN_PREFIXES.some((p) => key.startsWith(p))) {
      console.error(`Refusing to run: key '${key}' is under a forbidden (other-app) prefix.`);
      process.exit(1);
    }
    const parts = key.split("/");
    if (parts[0] !== "vlad" || !VLAD_SUBPREFIXES.has(parts[1])) {
      console.error(`Refusing to run: key '${key}' is not under a VLAD sub-prefix (expected vlad/<sub>/...).`);
      process.exit(1);
    }
    allKeys.push({ cat, key });
  }
}

// ---- Summary --------------------------------------------------------------

console.log(`\nPhase 0 R2 orphan cleanup — bucket: ${BUCKET}`);
console.log(EXECUTE ? "MODE: EXECUTE (will delete)" : "MODE: DRY-RUN (no deletes)\n");

let grandCount = 0;
let grandBytes = 0;
console.log("Per-category:");
for (const [cat, keys] of Object.entries(orphans)) {
  const bytes = keys.reduce((s, k) => s + (sizeByKey.get(k) ?? 0), 0);
  grandCount += keys.length;
  grandBytes += bytes;
  console.log(`  ${cat.padEnd(58)} ${String(keys.length).padStart(6)} objs   ${fmt(bytes)}`);
}
console.log("  " + "-".repeat(58) + "  " + "-".repeat(20));
console.log(`  ${"TOTAL".padEnd(58)} ${String(grandCount).padStart(6)} objs   ${fmt(grandBytes)}\n`);

if (!EXECUTE) {
  console.log("Dry run complete. Re-run with --execute to delete.");
  process.exit(0);
}

// ---- Delete ---------------------------------------------------------------

const BATCH = 1000;
let deleted = 0;
let errored = 0;
const errors = [];

for (let i = 0; i < allKeys.length; i += BATCH) {
  const batch = allKeys.slice(i, i + BATCH);
  const Objects = batch.map(({ key }) => ({ Key: key }));
  const res = await client.send(
    new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects, Quiet: true },
    }),
  );
  const errs = res.Errors ?? [];
  errored += errs.length;
  deleted += batch.length - errs.length;
  for (const e of errs) errors.push(`${e.Key}: ${e.Code} ${e.Message}`);
  console.log(`  batch ${i / BATCH + 1}/${Math.ceil(allKeys.length / BATCH)} — sent ${batch.length}, errs ${errs.length}, running total deleted ${deleted}`);
}

console.log(`\nDone. Deleted ${deleted} objects, ${errored} errors.`);
if (errors.length) {
  console.log("\nFirst 20 errors:");
  for (const e of errors.slice(0, 20)) console.log("  " + e);
}
