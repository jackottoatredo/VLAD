import { supabase } from "@/lib/db/supabase";

/**
 * Collision-only suffix resolver. Given a base, returns the smallest unused
 * candidate from `[base, base-2, base-3, ...]` (capped at 10000).
 *
 * Used for three uniqueness scopes:
 *   - vlad_recordings.name (per-user)  — recording names
 *   - vlad_renders.brand   (per-user)  — render display labels
 *   - vlad_renders.slug    (global)    — share URLs
 *
 * The caller actually inserts the candidate; on a 23505 race the caller
 * should re-call this and retry. Slug uniqueness is also enforced by a
 * partial unique index, so concurrent inserts can't both win.
 */
type ReserveScope =
  | { table: "vlad_recordings"; column: "name"; userId: string }
  | { table: "vlad_renders"; column: "brand"; userId: string }
  | { table: "vlad_renders"; column: "slug" };

export async function reserveUniqueName(opts: ReserveScope & { base: string }): Promise<string> {
  if (!opts.base) throw new Error("reserveUniqueName: base must be non-empty");
  const { table, column, base } = opts;

  // ILIKE treats `_` as a single-char wildcard. Bases never contain `_`
  // (slugifyPart strips them) but we still filter exact matches via regex.
  let query = supabase.from(table).select(column).ilike(column, `${base}%`);
  if ("userId" in opts) {
    query = query.eq("user_id", opts.userId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`reserveUniqueName(${table}.${column}) query failed: ${error.message}`);
  }

  const exactRe = new RegExp(`^${escapeRegex(base)}(?:-(\\d+))?$`);
  const taken = new Set<string>();
  for (const row of (data ?? []) as Array<Record<string, string | null>>) {
    const v = row[column];
    if (typeof v === "string" && exactRe.test(v)) taken.add(v);
  }

  if (!taken.has(base)) return base;
  for (let n = 2; n <= 10_000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`reserveUniqueName: exhausted suffixes for "${base}"`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
