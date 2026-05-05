import type { Keyframe } from "@/lib/render/keyframes";

/**
 * Cursor position at session time `targetT` (in ms from session start),
 * interpolated linearly between the surrounding position keyframes.
 * Returns null when there are no keyframes.
 */
export function computeMousePosAtTime(
  keyframes: ReadonlyArray<Keyframe>,
  targetT: number,
): { x: number; y: number } | null {
  if (keyframes.length === 0) return null;

  const sessionEndMs = keyframes[keyframes.length - 1].t;
  const clamped = Math.max(0, Math.min(targetT, sessionEndMs));

  if (clamped <= keyframes[0].t) {
    return { x: Math.round(keyframes[0].x), y: Math.round(keyframes[0].y) };
  }
  if (clamped >= sessionEndMs) {
    const last = keyframes[keyframes.length - 1];
    return { x: Math.round(last.x), y: Math.round(last.y) };
  }

  let lo = 0;
  let hi = keyframes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].t <= clamped) lo = mid + 1;
    else hi = mid;
  }
  const prev = keyframes[lo - 1];
  const next = keyframes[lo];
  const alpha = (clamped - prev.t) / (next.t - prev.t);
  return {
    x: Math.round(prev.x + (next.x - prev.x) * alpha),
    y: Math.round(prev.y + (next.y - prev.y) * alpha),
  };
}

/**
 * Cursor position at the START of a section's exit window — i.e.
 * `transitionDurationMs` ms before the section's end. Used in the crossfade
 * path so intro's exit glide and product's entry glide both anchor to the
 * same starting point and trace identical paths during the xfade overlap.
 */
export function computeMousePosAtExitStart(
  keyframes: ReadonlyArray<Keyframe>,
  trimStartSec: number | undefined,
  trimEndSec: number | undefined,
  transitionDurationMs: number,
): { x: number; y: number } | null {
  if (keyframes.length === 0) return null;
  const sessionEndMs = keyframes[keyframes.length - 1].t;
  const startMs = trimStartSec != null && trimStartSec > 0 ? trimStartSec * 1000 : 0;
  const endMs =
    trimEndSec != null && trimEndSec > 0
      ? Math.min(trimEndSec * 1000, sessionEndMs)
      : sessionEndMs;
  // Don't go before the section's start — degenerate case: exit window is
  // longer than the section itself. Clamp to startMs so the glide still
  // resolves, even if the duration ends up being shorter than requested.
  const exitStart = Math.max(startMs, endMs - transitionDurationMs);
  return computeMousePosAtTime(keyframes, exitStart);
}
