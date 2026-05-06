// Coarse mobile/tablet/desktop categorization from the UA string.
// Orthogonal to UA family — Chrome on Android is ua_family='chrome',
// device_type='mobile'.
//
// Known limitation: iPadOS 13+ defaults to "request desktop site" so
// modern iPads will be classified as desktop. Server-side UA can't fix
// this; it'd need a client-side `navigator.maxTouchPoints` check.

export type DeviceType = "mobile" | "tablet" | "desktop" | "other";

export function parseDeviceType(userAgent: string | null): DeviceType {
  if (!userAgent) return "other";
  // Tablet first — iPad/Android-tablet UAs often also include "Mobile" or
  // "Safari", so the more specific match has to come first.
  if (/iPad|Tablet|Nexus 7|Nexus 9|Nexus 10/i.test(userAgent)) return "tablet";
  if (/Mobi|iPhone|iPod|Android.*Mobile|webOS|Windows Phone/i.test(userAgent)) {
    return "mobile";
  }
  // Common desktop OS markers — restrict the desktop bucket so genuinely
  // unknown UAs fall through to 'other' instead of getting mislabeled.
  if (/Macintosh|Windows NT|Linux x86|CrOS/i.test(userAgent)) return "desktop";
  return "other";
}
