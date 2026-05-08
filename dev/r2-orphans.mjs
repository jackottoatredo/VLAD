// Cross-reference R2 listing (dev/r2-listing.json) against Supabase to identify
// orphans: keys present in R2 with no DB row referencing them.
//
// Considers VLAD-owned prefixes only. Other-app prefixes (harvest/, screenshots/,
// images/, html/, raw-batches/, captures/) are listed but not classified —
// those belong to a different application sharing the bucket.
//
// Usage: node --env-file=.env.local dev/r2-orphans.mjs

import { readFileSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) throw new Error("Supabase env not set");

async function fetchAll(table, columns) {
  const out = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${columns.join(",")}`;
    const res = await fetch(url, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${from}-${from + PAGE - 1}`,
        Prefer: "count=none",
      },
    });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

console.error("Fetching vlad_recordings...");
const recordings = await fetchAll("vlad_recordings", [
  "id",
  "status",
  "mouse_events_url",
  "webcam_url",
  "preview_url",
]);
console.error(`  ${recordings.length} rows`);

console.error("Fetching vlad_renders...");
const renders = await fetchAll("vlad_renders", [
  "id",
  "status",
  "stale",
  "video_url",
  "poster_key",
  "poster_square_key",
  "gif_key",
]);
console.error(`  ${renders.length} rows`);

// Build the set of R2 keys explicitly referenced by the database.
const referenced = new Set();
for (const r of recordings) {
  if (r.mouse_events_url) referenced.add(r.mouse_events_url);
  if (r.webcam_url) referenced.add(r.webcam_url);
  if (r.preview_url) referenced.add(r.preview_url);
}
for (const r of renders) {
  if (r.video_url) referenced.add(r.video_url);
  if (r.poster_key) referenced.add(r.poster_key);
  if (r.poster_square_key) referenced.add(r.poster_square_key);
  if (r.gif_key) referenced.add(r.gif_key);
}

// Derived siblings the code computes from the canonical webcam key.
const derivedSiblings = new Set();
for (const r of recordings) {
  if (r.webcam_url && r.webcam_url.endsWith(".webm")) {
    derivedSiblings.add(r.webcam_url.replace(/\.webm$/i, ".amplitude.json"));
    derivedSiblings.add(r.webcam_url.replace(/\.webm$/i, ".frames.bin"));
  }
}

// Active recording flowIds — needed to evaluate recordings/{recordingId}/.
const activeFlowIds = new Set(recordings.map((r) => r.id));
const draftFlowIds = new Set(recordings.filter((r) => r.status === "draft").map((r) => r.id));
const activeRenderIds = new Set(renders.map((r) => r.id));

const all = JSON.parse(readFileSync("dev/r2-listing.json", "utf8"));

// Post-restructure layout: every VLAD key lives at
// `vlad/users/{userId}/{recordings|renders}/{entityId}/...`. Anything outside
// `vlad/users/` is either other-app data, a stray pre-migration leftover, or
// shouldn't exist — call out the latter two so they get swept.
const activeRecordingIds = activeFlowIds; // alias: flowId === recordingId by construction

const orphans = {
  "recordings/{id}/ no DB row": [],
  "renders/{id}/ no DB row": [],
  "vlad/ stray (not under users/)": [],
};

const fmt = (n) =>
  n > 1e9 ? (n / 1e9).toFixed(2) + " GB" : n > 1e6 ? (n / 1e6).toFixed(2) + " MB" : n > 1e3 ? (n / 1e3).toFixed(2) + " KB" : n + " B";

for (const obj of all) {
  const parts = obj.key.split("/");

  // Only classify keys under the vlad/ namespace. Other-app prefixes get a
  // pass — those belong to a different application sharing the bucket.
  if (parts[0] !== "vlad") continue;

  // Anything under vlad/ that isn't users/{userId}/{recordings|renders}/{id}/
  // is a stray. Includes leftover top-level subdirs from before the
  // restructure (sessions/, composites/, trims/, merges/) plus any
  // accidentally-misplaced new writes.
  if (
    parts[1] !== "users" ||
    !parts[2] ||
    (parts[3] !== "recordings" && parts[3] !== "renders") ||
    !parts[4]
  ) {
    orphans["vlad/ stray (not under users/)"].push(obj);
    continue;
  }

  const kind = parts[3]; // "recordings" | "renders"
  const entityId = parts[4];

  if (kind === "recordings") {
    if (!activeRecordingIds.has(entityId)) {
      orphans["recordings/{id}/ no DB row"].push(obj);
    }
    // Otherwise the entity row is alive — every file under it (canonical
    // session data, preview, intermediates) is legitimately owned. Hook 1
    // wipes them all on recording delete.
    void draftFlowIds;
    void referenced;
    void derivedSiblings;
    continue;
  }

  if (kind === "renders") {
    if (!activeRenderIds.has(entityId)) {
      orphans["renders/{id}/ no DB row"].push(obj);
    }
    continue;
  }
}

console.log("\n=== VLAD ORPHAN BREAKDOWN ===\n");
let totalCount = 0;
let totalBytes = 0;
for (const [name, arr] of Object.entries(orphans)) {
  const bytes = arr.reduce((s, o) => s + o.size, 0);
  totalCount += arr.length;
  totalBytes += bytes;
  console.log(`  ${name.padEnd(56)} ${String(arr.length).padStart(7)} objs   ${fmt(bytes)}`);
}
console.log("  " + "-".repeat(56) + "  " + "-".repeat(20));
console.log(`  ${"TOTAL VLAD ORPHANS".padEnd(56)} ${String(totalCount).padStart(7)} objs   ${fmt(totalBytes)}`);

// Summarise things still tied to a live entity. Post-restructure that's
// every key under a live recordingId or renderId — including intermediates
// that aren't in any DB column. The orphan/live binary becomes:
//   live   = key sits inside a recording / render dir whose row exists
//   orphan = everything else under vlad/
let liveSize = 0;
let liveCount = 0;
const liveByEntity = new Map();
for (const obj of all) {
  const parts = obj.key.split("/");
  if (parts[0] !== "vlad" || parts[1] !== "users" || !parts[3] || !parts[4]) continue;
  const kind = parts[3];
  const entityId = parts[4];
  const aliveSet = kind === "recordings" ? activeRecordingIds : kind === "renders" ? activeRenderIds : null;
  if (!aliveSet || !aliveSet.has(entityId)) continue;
  liveSize += obj.size;
  liveCount++;
  const bucket = `vlad/users/${parts[2]}/${kind}`;
  const cur = liveByEntity.get(bucket) ?? { count: 0, bytes: 0 };
  cur.count++;
  cur.bytes += obj.size;
  liveByEntity.set(bucket, cur);
}
console.log("\n=== LIVE (under an existing recording or render row) ===");
for (const [name, { count, bytes }] of [...liveByEntity].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`  ${name.padEnd(60)} ${String(count).padStart(7)} objs   ${fmt(bytes)}`);
}
console.log(`  ${"TOTAL".padEnd(60)} ${String(liveCount).padStart(7)} objs   ${fmt(liveSize)}`);

// Sample orphans for manual sanity-check.
console.log("\n=== ORPHAN SAMPLES (5 each) ===");
for (const [name, arr] of Object.entries(orphans)) {
  if (arr.length === 0) continue;
  console.log(`\n${name}:`);
  for (const o of arr.slice(0, 5)) {
    console.log(`  ${o.key}  (${fmt(o.size)}, ${o.lastModified})`);
  }
}

writeFileSync(
  "dev/r2-orphans.json",
  JSON.stringify(
    Object.fromEntries(Object.entries(orphans).map(([k, v]) => [k, v.map((o) => o.key)])),
  ),
);
console.log(`\nWrote dev/r2-orphans.json (orphan keys per category).`);
