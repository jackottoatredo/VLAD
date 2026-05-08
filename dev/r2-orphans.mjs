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

// Active recording flowIds — needed to evaluate sessions/{user}/{flowId}/.
const activeFlowIds = new Set(recordings.map((r) => r.id));
const draftFlowIds = new Set(recordings.filter((r) => r.status === "draft").map((r) => r.id));

const all = JSON.parse(readFileSync("dev/r2-listing.json", "utf8"));

// Sub-prefixes under the vlad/ namespace. Post-migration every VLAD-owned
// key is shaped as `vlad/<sub>/...`. Anything outside vlad/ is either other-app
// data (other Redo apps share this bucket) or pre-migration leftover and is
// skipped here — Phase 4 / cleanup-postrestart already cleaned those up.
const VLAD_SUBPREFIXES = new Set([
  "sessions",
  "recordings",
  "renders",
  "merges",
  "composites",
  "trims",
  "users",
]);

const orphans = {
  "sessions (no recording row)": [],
  "sessions (saved row, but session orig kept)": [],
  "recordings/{id}/ legacy mouse+webcam": [],
  "recordings/{id}/preview.mp4 (no row)": [],
  "renders (not referenced by any render row)": [],
  "merges (not referenced by any render row)": [],
  "composites (intermediate, never DB-referenced)": [],
  "trims (intermediate, never DB-referenced)": [],
  "users/ (legacy render path)": [],
};

const fmt = (n) =>
  n > 1e9 ? (n / 1e9).toFixed(2) + " GB" : n > 1e6 ? (n / 1e6).toFixed(2) + " MB" : n > 1e3 ? (n / 1e3).toFixed(2) + " KB" : n + " B";

for (const obj of all) {
  const parts = obj.key.split("/");

  // Only classify keys under the vlad/ namespace. Other-app + stray keys
  // (harvest/, screenshots/, ..., or anything outside vlad/) are skipped.
  if (parts[0] !== "vlad") continue;

  const sub = parts[1];
  if (!VLAD_SUBPREFIXES.has(sub)) continue;

  if (sub === "users") {
    orphans["users/ (legacy render path)"].push(obj);
    continue;
  }

  if (sub === "sessions") {
    // Pattern: vlad/sessions/{userIdOrSlug}/{flowId}/{file}
    const flowId = parts[3];
    if (!flowId || !activeFlowIds.has(flowId)) {
      orphans["sessions (no recording row)"].push(obj);
    } else if (!draftFlowIds.has(flowId)) {
      // Recording is saved — original session file MAY still be the canonical
      // mouse_events_url / webcam_url; check explicit reference first.
      if (!referenced.has(obj.key) && !derivedSiblings.has(obj.key)) {
        orphans["sessions (saved row, but session orig kept)"].push(obj);
      }
    }
    continue;
  }

  if (sub === "recordings") {
    // Pattern: vlad/recordings/{flowId}/{file}
    const flowId = parts[2];
    const file = parts[3];
    if (file === "mouse.json" || file === "webcam.webm" || (file && file.startsWith("webcam."))) {
      // Legacy path — current code writes mouse + webcam to sessions/, only
      // preview.mp4 lives at recordings/{id}/.
      if (referenced.has(obj.key)) {
        // Some legacy rows still point at this path — keep them.
      } else {
        orphans["recordings/{id}/ legacy mouse+webcam"].push(obj);
      }
    } else if (file === "preview.mp4") {
      if (!referenced.has(obj.key)) {
        orphans["recordings/{id}/preview.mp4 (no row)"].push(obj);
      }
    }
    void flowId;
    continue;
  }

  if (sub === "renders") {
    if (!referenced.has(obj.key)) {
      orphans["renders (not referenced by any render row)"].push(obj);
    }
    continue;
  }
  if (sub === "merges") {
    if (!referenced.has(obj.key)) {
      orphans["merges (not referenced by any render row)"].push(obj);
    }
    continue;
  }
  if (sub === "composites") {
    // Defensive: even though composites are intermediate, vlad_recordings.preview_url
    // CAN point at composites/.../preview.mp4 in some legacy/recording flows.
    if (!referenced.has(obj.key)) {
      orphans["composites (intermediate, never DB-referenced)"].push(obj);
    }
    continue;
  }
  if (sub === "trims") {
    // Defensive: when a render has a trim, vlad_renders.video_url (and sibling
    // poster/gif keys via path.posix.dirname) live under trims/.
    if (!referenced.has(obj.key)) {
      orphans["trims (intermediate, never DB-referenced)"].push(obj);
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

// Summarise things that ARE still referenced, so we can compare.
let referencedSize = 0;
let referencedCount = 0;
const liveByPrefix = new Map();
for (const obj of all) {
  if (referenced.has(obj.key)) {
    referencedSize += obj.size;
    referencedCount++;
    const parts = obj.key.split("/");
    const top = parts[0] === "vlad" && parts[1] ? `vlad/${parts[1]}` : parts[0];
    const cur = liveByPrefix.get(top) ?? { count: 0, bytes: 0 };
    cur.count++;
    cur.bytes += obj.size;
    liveByPrefix.set(top, cur);
  }
}
console.log("\n=== LIVE (DB-REFERENCED) ===");
for (const [name, { count, bytes }] of [...liveByPrefix].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`  ${name.padEnd(20)} ${String(count).padStart(7)} objs   ${fmt(bytes)}`);
}
console.log(`  ${"TOTAL".padEnd(20)} ${String(referencedCount).padStart(7)} objs   ${fmt(referencedSize)}`);

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
