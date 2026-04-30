// Coarse browser-family categorization. Six buckets is plenty for a
// dashboard donut — finer detail (version, OS) is noise. Mobile Safari is
// split out because it's the dominant share-link viewer on iPhone and
// behaves differently from desktop Safari for autoplay/seeking.

export type UaFamily =
  | "chrome"
  | "safari"
  | "mobile-safari"
  | "firefox"
  | "edge"
  | "other";

export function parseUaFamily(userAgent: string | null): UaFamily {
  if (!userAgent) return "other";
  // Order matters: Edge UA also includes "Chrome", iOS Safari includes
  // "Safari" but not "Chrome". Test the more-specific strings first.
  if (/Edg\//.test(userAgent)) return "edge";
  if (/Firefox\//.test(userAgent)) return "firefox";
  if (/iPhone|iPad|iPod/.test(userAgent) && /Safari\//.test(userAgent)) return "mobile-safari";
  if (/Chrome\//.test(userAgent)) return "chrome";
  if (/Safari\//.test(userAgent)) return "safari";
  return "other";
}
