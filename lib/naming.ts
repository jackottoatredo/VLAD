// Pure naming primitives — safe to import from browser code (no supabase).
// The DB-touching `reserveUniqueName` lives in `lib/db/reserveName.ts`.
//
// All names in the system follow lowercase-with-dash-separators. Compound
// names are assembled from these parts and deduplicated via reserveUniqueName.

const NON_SLUG_CHAR = /[^a-z0-9-]/g;
const COLLAPSE_DASHES = /-+/g;
const TRIM_DASHES = /^-+|-+$/g;

/**
 * Lowercase, replace non-alphanumeric/non-dash chars with `-`, collapse runs
 * of dashes, and trim leading/trailing dashes. Idempotent.
 *
 *   "Trion 28"      → "trion-28"
 *   "And Collar!"   → "and-collar"
 *   "  __foo__  "   → "foo"
 *   ""              → ""
 */
export function slugifyPart(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(NON_SLUG_CHAR, "-")
    .replace(COLLAPSE_DASHES, "-")
    .replace(TRIM_DASHES, "");
}

/** Slugify each non-empty part and join with `-`. */
export function joinNameParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => slugifyPart(p))
    .filter(Boolean)
    .join("-");
}

/**
 * Strip protocol, leading `www.`, path/query, and the public TLD. Used as
 * the merchant-name fallback when a merchant recording's previews row is
 * missing or has no brandName.
 *
 *   "https://www.mammut.com/products/foo" → "mammut"
 *   "shop.example.co.uk"                  → "shop-example-co"
 *   "mammut"                              → "mammut"
 *   ""                                    → ""
 */
export function deriveMerchantNameFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  let host = url.trim().replace(/^https?:\/\//i, "").replace(/^\/+/, "");
  host = host.split(/[/?#]/)[0];
  host = host.replace(/^www\./i, "");
  if (!host) return "";
  const segments = host.split(".").filter(Boolean);
  if (segments.length < 2) return slugifyPart(segments[0] ?? "");
  return slugifyPart(segments.slice(0, -1).join("-"));
}
