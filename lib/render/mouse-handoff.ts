import type { Keyframe } from "@/lib/render/keyframes";

/**
 * Compute the cursor position at the END of a section's playback window —
 * used to seed the next section's mouse handoff so the cursor doesn't
 * teleport across the merge boundary.
 *
 * Returns the position at `trimEndMs` (clamped to last keyframe), or null
 * if the section has no keyframes.
 */
export function computeLastMousePos(
  keyframes: ReadonlyArray<Keyframe>,
  trimStartSec: number | undefined,
  trimEndSec: number | undefined,
): { x: number; y: number } | null {
  if (keyframes.length === 0) return null;

  const sessionEndMs = keyframes[keyframes.length - 1].t;
  const startMs = trimStartSec != null && trimStartSec > 0 ? trimStartSec * 1000 : 0;
  const endMs =
    trimEndSec != null && trimEndSec > 0
      ? Math.min(trimEndSec * 1000, sessionEndMs)
      : sessionEndMs;
  // After trim we always have at least one frame; default to the final clamped t.
  const targetT = Math.max(startMs, endMs);

  // Find the last keyframe at or before targetT (binary search).
  if (targetT <= keyframes[0].t) {
    return { x: Math.round(keyframes[0].x), y: Math.round(keyframes[0].y) };
  }
  if (targetT >= sessionEndMs) {
    const last = keyframes[keyframes.length - 1];
    return { x: Math.round(last.x), y: Math.round(last.y) };
  }

  let lo = 0;
  let hi = keyframes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].t <= targetT) lo = mid + 1;
    else hi = mid;
  }
  const prev = keyframes[lo - 1];
  const next = keyframes[lo];
  const alpha = (targetT - prev.t) / (next.t - prev.t);
  return {
    x: Math.round(prev.x + (next.x - prev.x) * alpha),
    y: Math.round(prev.y + (next.y - prev.y) * alpha),
  };
}
