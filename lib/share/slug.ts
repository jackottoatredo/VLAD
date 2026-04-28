import { supabase } from "@/lib/db/supabase";

const SANITIZE_RE = /[^a-z0-9_-]/gi;
const COLLAPSE_RE = /-+/g;
const TRIM_RE = /^-+|-+$/g;

function slugifyPart(s: string): string {
  return s.toLowerCase().replace(SANITIZE_RE, "-").replace(COLLAPSE_RE, "-").replace(TRIM_RE, "");
}

export function buildBaseSlug(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .map(slugifyPart)
    .filter(Boolean)
    .join("-");
}

// LIKE/ILIKE treats `_` as a single-char wildcard, so a prefix query for
// `foo_bar%` may return unrelated rows. We over-fetch and filter client-side.
export async function reserveUniqueSlug(base: string): Promise<string> {
  if (!base) throw new Error("reserveUniqueSlug: base must be non-empty");

  const { data, error } = await supabase
    .from("vlad_renders")
    .select("slug")
    .ilike("slug", `${base}%`);

  if (error) throw new Error(`reserveUniqueSlug query failed: ${error.message}`);

  const exactRe = new RegExp(`^${base}(?:-(\\d+))?$`);
  const taken = new Set<string>();
  for (const row of (data ?? []) as Array<{ slug: string | null }>) {
    if (row.slug && exactRe.test(row.slug)) taken.add(row.slug);
  }

  if (!taken.has(base)) return base;
  for (let n = 2; n <= 10_000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`reserveUniqueSlug: exhausted suffixes for base "${base}"`);
}
