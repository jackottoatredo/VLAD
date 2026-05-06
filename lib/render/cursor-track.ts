import { interpolatePosition, type Keyframe } from "@/lib/render/keyframes";
import type { MouseTrackSpec } from "@/lib/render/spec";
import {
  applyEasing,
  applyGlideStutter,
  arcedGlidePoint,
  clampCoordinate,
} from "@/lib/render/glide-math";

/**
 * Default cursor resting position when a section has no recorded mouse
 * movement. Lower-right of the canvas — feels natural (close button /
 * scrollbar territory) and gives the merge-boundary glide a real anchor
 * to land on instead of the geometric centre.
 */
export const CURSOR_REST_X_FRAC = 0.78;
export const CURSOR_REST_Y_FRAC = 0.86;

export function cursorRestPosition(width: number, height: number): { x: number; y: number } {
  return {
    x: clampCoordinate(Math.round(width * CURSOR_REST_X_FRAC), width),
    y: clampCoordinate(Math.round(height * CURSOR_REST_Y_FRAC), height),
  };
}

export type CursorPositionsInput = {
  /** Recorded keyframes from the section's mouse events. Position keyframes
   *  drive interpolation; click/keydown events are ignored (they don't move
   *  the cursor). */
  keyframes: ReadonlyArray<Keyframe>;
  fps: number;
  width: number;
  height: number;
  /** Total number of render frames — must match the rendered video's frame
   *  count exactly so the per-frame PNG sequence aligns 1:1. */
  totalFrames: number;
  /** Trim window in session-time ms. Glides anchor to these boundaries.
   *  Outside the trim window, positions follow recorded keyframes. */
  trimStartMs?: number;
  trimEndMs?: number;
  /** Boundary glides that override the cursor's recorded position at the
   *  trim-window edges. Used in the symmetric merge model so the cursor
   *  travels A → MIDPOINT in intro's last D/2 and MIDPOINT → B in
   *  product's first D/2. */
  mouseTrack?: MouseTrackSpec;
};

/**
 * Compute one (x, y) cursor position per RENDER frame, over the full
 * session duration. Pure function — no I/O.
 *
 * `result.length === totalFrames`, indexed in render-frame order. When
 * `mouseTrack` provides boundary glides, the first/last D ms of the trim
 * window are overridden:
 *
 *   - glideIn  (frames `[trimStart, trimStart + N)`):
 *       sweep from `glideIn.point` to recorded(trimStart + N·frameDur).
 *       The target is the cursor's recorded position at the FRAME AFTER
 *       the glide window — that way the post-glide frame continues
 *       seamlessly along the recorded path with no snap-forward.
 *   - glideOut (frames `[trimEnd - N, trimEnd)`):
 *       sweep from recorded(trimEnd - N·frameDur) to `glideOut.point`.
 *       The first glide frame matches the recorded position immediately
 *       before the window, so entry into the glide is smooth.
 *
 * Frame-index mapping uses `t = k / (N-1)` (with N=1 → t=1) so the last
 * glide frame reaches the target exactly. This guarantees zero
 * discontinuity when two slices meet at the merge boundary (both ends
 * land exactly on the shared MIDPOINT).
 */
export function computeCursorPositions(input: CursorPositionsInput): { x: number; y: number }[] {
  const { keyframes, fps, width, height, totalFrames, mouseTrack } = input;
  const positionKeyframes = keyframes.filter((kf) => kf.event !== "keydown");

  // No recorded movement → synthesize a single rest-position keyframe at
  // t=0. Downstream, `interpolatePosition` returns that single point for
  // every query, so the cursor parks at rest. Crucially we do NOT
  // early-return: any merge-boundary glide still applies (its source or
  // target lands on the rest position, which makes the boundary smooth
  // without a jump).
  const effectiveKeyframes: ReadonlyArray<Keyframe> =
    positionKeyframes.length > 0
      ? positionKeyframes
      : (() => {
          const rest = cursorRestPosition(width, height);
          return [{ t: 0, x: rest.x, y: rest.y }];
        })();

  const sessionEndMs = keyframes.length > 0 ? keyframes[keyframes.length - 1].t : 0;
  const trimStartMs = input.trimStartMs ?? 0;
  const trimEndMs = input.trimEndMs ?? sessionEndMs;
  const frameDurationMs = 1000 / fps;

  // Frame indices defining the glide windows.
  const trimStartFrame = Math.round(trimStartMs / frameDurationMs);
  const trimEndFrame = Math.round(trimEndMs / frameDurationMs);

  const glideInFrames = mouseTrack?.glideIn
    ? Math.max(1, Math.round((mouseTrack.glideIn.durationMs / 1000) * fps))
    : 0;
  const glideOutFrames = mouseTrack?.glideOut
    ? Math.max(1, Math.round((mouseTrack.glideOut.durationMs / 1000) * fps))
    : 0;
  const glideInEndFrame = trimStartFrame + glideInFrames;
  const glideOutStartFrame = trimEndFrame - glideOutFrames;

  const sampleRecorded = (tMs: number): { x: number; y: number } => {
    const p = interpolatePosition(effectiveKeyframes, tMs);
    return {
      x: clampCoordinate(Math.round(p.x), width),
      y: clampCoordinate(Math.round(p.y), height),
    };
  };

  // Anchor positions at the OUTER edges of each glide window — the
  // recorded cursor positions the glide must connect to so the boundary
  // with the recorded path is smooth.
  //
  //   glideIn target  = recorded(trimStart + N·frameDur) — matches the
  //                     first POST-glide frame, so the cursor lands and
  //                     continues along the recorded path with no jump.
  //   glideOut source = recorded(trimEnd - N·frameDur)  — matches the
  //                     last PRE-glide frame, so glide entry is smooth.
  const glideInTarget = mouseTrack?.glideIn
    ? sampleRecorded(trimStartMs + glideInFrames * frameDurationMs)
    : null;
  const glideOutSource = mouseTrack?.glideOut
    ? sampleRecorded(trimEndMs - glideOutFrames * frameDurationMs)
    : null;

  const positions: { x: number; y: number }[] = new Array(totalFrames);

  for (let i = 0; i < totalFrames; i++) {
    let x: number;
    let y: number;

    if (
      mouseTrack?.glideIn &&
      glideInTarget &&
      i >= trimStartFrame &&
      i < glideInEndFrame &&
      glideInFrames > 0
    ) {
      const k = i - trimStartFrame; // 0..glideInFrames-1
      const t = glideInFrames > 1 ? k / (glideInFrames - 1) : 1;
      const eased = applyGlideStutter(
        applyEasing(t, mouseTrack.glideIn.easing),
        t,
        mouseTrack.glideIn.shape.stutterAmplitude,
        mouseTrack.glideIn.shape.stutterFrequency,
      );
      const pt = arcedGlidePoint(
        mouseTrack.glideIn.point,
        glideInTarget,
        eased,
        mouseTrack.glideIn.shape.arcFraction,
      );
      x = clampCoordinate(Math.round(pt.x), width);
      y = clampCoordinate(Math.round(pt.y), height);
    } else if (
      mouseTrack?.glideOut &&
      glideOutSource &&
      i >= glideOutStartFrame &&
      i < trimEndFrame &&
      glideOutFrames > 0
    ) {
      const k = i - glideOutStartFrame; // 0..glideOutFrames-1
      const t = glideOutFrames > 1 ? k / (glideOutFrames - 1) : 1;
      const eased = applyGlideStutter(
        applyEasing(t, mouseTrack.glideOut.easing),
        t,
        mouseTrack.glideOut.shape.stutterAmplitude,
        mouseTrack.glideOut.shape.stutterFrequency,
      );
      const pt = arcedGlidePoint(
        glideOutSource,
        mouseTrack.glideOut.point,
        eased,
        mouseTrack.glideOut.shape.arcFraction,
      );
      x = clampCoordinate(Math.round(pt.x), width);
      y = clampCoordinate(Math.round(pt.y), height);
    } else {
      // Default: recorded cursor at this frame's session time.
      const tSession = i * frameDurationMs;
      const recorded = sampleRecorded(tSession);
      x = recorded.x;
      y = recorded.y;
    }

    positions[i] = { x, y };
  }

  return positions;
}
