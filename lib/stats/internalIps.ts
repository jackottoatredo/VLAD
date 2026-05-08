// IP hashes treated as internal — set INTERNAL_IP_HASHES in env as a
// comma-separated list (e.g. "e650bf6e991b6958,abc123..."). Any visit
// with an ip_hash in this set is treated as team traffic by the
// engagement dashboard (tagged `internal` in the Referrer sources donut)
// AND suppressed from rep notifications (no DM on internal visits).
// Update freely; the change picks up retroactively because it's applied
// at read/dispatch time.
export const INTERNAL_IP_HASHES = new Set(
  (process.env.INTERNAL_IP_HASHES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export function isInternalIpHash(ipHash: string | null | undefined): boolean {
  return ipHash != null && INTERNAL_IP_HASHES.has(ipHash);
}
