import { type Page } from "playwright";
import { interpolatePosition, discreteEventsInWindow, type Keyframe } from "@/lib/render/keyframes";
import type { MouseEasing, MouseGlideShape } from "@/lib/render/spec";

/** A no-op shape — straight line, no stutter. Used as the default when a
 *  glide is requested without an explicit shape (defensive). */
const STRAIGHT_SHAPE: MouseGlideShape = {
  arcFraction: 0,
  stutterAmplitude: 0,
  stutterFrequency: 0,
};

export type CursorPosition = {
  x: number;
  y: number;
};

export type RenderActionRunContext = {
  page: Page;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  startCursor?: CursorPosition;
  moveAndCapture: (x: number, y: number) => Promise<void>;
  /** Advance the virtual clock by one frame without capturing a screenshot. */
  advanceOnly: () => Promise<void>;
};

export type RenderAction = {
  name: string;
  durationMs: number;
  // Each action receives the previous action's end cursor in context.startCursor
  // and must return its own final cursor position for chaining continuity.
  run: (context: RenderActionRunContext) => Promise<CursorPosition>;
};

function clampCoordinate(value: number, max: number): number {
  return Math.min(Math.max(value, 0), Math.max(max - 1, 0));
}

/** Smoothstep / cubic Hermite — gentle slow-in/slow-out. */
function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Cubic ease-in-out — sharper acceleration than smoothstep, matches CSS `ease-in-out`. */
function cubicEaseInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function applyEasing(t: number, easing: MouseEasing): number {
  return easing === "cubicEaseInOut" ? cubicEaseInOut(t) : easeInOut(t);
}

/**
 * Perturb the eased glide parameter so the cursor's speed wobbles slightly
 * along the path. Deterministic — driven by linear `t`, so frequency stays
 * uniform in time regardless of easing. The `sin(π·t)` envelope keeps the
 * perturbation at 0 at both endpoints, so the cursor still lands exactly.
 */
function applyGlideStutter(
  easedT: number,
  t: number,
  amplitude: number,
  frequency: number,
): number {
  if (amplitude === 0) return easedT;
  const envelope = Math.sin(Math.PI * t);
  const wiggle = Math.sin(2 * Math.PI * frequency * t);
  const perturbed = easedT + amplitude * envelope * wiggle;
  // Clamp defensively — with tiny amplitudes this rarely fires, but a large
  // amplitude near the steep middle of the easing curve could push past [0,1].
  return Math.max(0, Math.min(1, perturbed));
}

/**
 * Quadratic Bezier sample along an arc from `from` to `to`, parameterised by
 * eased `t` ∈ [0, 1]. The control point is pinned ABOVE the straight-line
 * midpoint (toward y=0) by `arcFraction × distance` — a consistent upward bow
 * that mimics the natural pivot of an arm/wrist over a desk surface.
 *
 * Endpoints are exact: t=0 returns `from`, t=1 returns `to`. arcFraction=0
 * degenerates to a straight line.
 */
function arcedGlidePoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number,
  arcFraction: number,
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { x: from.x, y: from.y };

  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2 - dist * arcFraction;

  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
    y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
  };
}

/**
 * Glide the cursor from `(fromX, fromY)` to `(toX, toY)` over `durationMs`
 * with an eased curve. Captures every frame — produces visible output.
 *
 * Used as the first action of a section in a merge, after the previous
 * section's last cursor position has been computed and threaded through
 * via spec.mouseHandoff.
 */
export function createMouseHandoffAction(
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationMs: number,
  easing: MouseEasing = "easeInOut",
  shape: MouseGlideShape = STRAIGHT_SHAPE,
): RenderAction {
  return {
    name: "mouse-handoff",
    durationMs,
    async run(context): Promise<CursorPosition> {
      const totalFrames = Math.max(1, Math.round((durationMs / 1000) * context.fps));

      let last: CursorPosition = {
        x: clampCoordinate(Math.round(from.x), context.width),
        y: clampCoordinate(Math.round(from.y), context.height),
      };

      for (let i = 0; i < totalFrames; i++) {
        const t = (i + 1) / totalFrames;
        const eased = applyGlideStutter(
          applyEasing(t, easing),
          t,
          shape.stutterAmplitude,
          shape.stutterFrequency,
        );
        const pt = arcedGlidePoint(from, to, eased, shape.arcFraction);
        const x = clampCoordinate(Math.round(pt.x), context.width);
        const y = clampCoordinate(Math.round(pt.y), context.height);
        await context.moveAndCapture(x, y);
        last = { x, y };
      }
      return last;
    },
  };
}

export type ReplayActionOptions = {
  trimStartMs?: number;
  /**
   * Section's effective trim window in session ms. When set, entry/exit glide
   * windows anchor to these boundaries (last N frames before `trimWindowEndMs`
   * for exit; first N frames at or after `trimWindowStartMs` for entry).
   *
   * Defaults: trimWindowStartMs=0, trimWindowEndMs=session end. The defaults
   * preserve legacy session-wide glide behavior for callers that don't pass
   * trim info.
   */
  trimWindowStartMs?: number;
  trimWindowEndMs?: number;
  /**
   * Entry glide: cursor sprite is overridden during the FIRST `durationMs` of
   * the trim window. Glide goes from `(fromX, fromY)` to `(toX, toY)` (or to
   * the recorded cursor position at the end of the entry window when toX/toY
   * are omitted — keeps continuity with replay's natural behavior).
   *
   * Discrete events still fire at recorded positions during this window.
   */
  entryGlide?: {
    fromX: number;
    fromY: number;
    toX?: number;
    toY?: number;
    durationMs: number;
    easing: MouseEasing;
    shape: MouseGlideShape;
  };
  /**
   * Exit glide: cursor sprite is overridden during the LAST `durationMs` of
   * the trim window. Glide goes from `(fromX, fromY)` (or recorded position
   * at exit-window start) to `(toX, toY)`.
   */
  exitGlide?: {
    fromX?: number;
    fromY?: number;
    toX: number;
    toY: number;
    durationMs: number;
    easing: MouseEasing;
    shape: MouseGlideShape;
  };
};

/**
 * Creates a replay action from keyframes.
 *
 * When `trimStartMs` is provided, Playwright replays ALL events from the
 * beginning (so the page reaches the correct state through clicks/keys) but
 * only captures screenshots for frames after `trimStartMs`.  The output
 * video duration is `durationMs` (which should already be trimEnd-trimStart).
 */
export function createReplayAction(
  keyframes: ReadonlyArray<Keyframe>,
  durationMs: number,
  options: ReplayActionOptions = {},
): RenderAction {
  const trimStartMs = options.trimStartMs ?? 0;
  const entryGlide = options.entryGlide;
  const exitGlide = options.exitGlide;
  const totalReplayMs = trimStartMs + durationMs;

  return {
    name: "session-replay",
    durationMs,
    async run(context): Promise<CursorPosition> {
      const frameDurationMs = 1000 / context.fps;

      if (keyframes.length === 0) {
        const x = clampCoordinate(Math.round(context.width / 2), context.width);
        const y = clampCoordinate(Math.round(context.height / 2), context.height);
        for (let i = 0; i < context.frameCount; i++) {
          await context.moveAndCapture(x, y);
        }
        return { x, y };
      }

      const positionKeyframes = keyframes.filter((kf) => kf.event !== "keydown");
      const sessionDurationMs = keyframes[keyframes.length - 1].t;
      // Clamp ≤ 1: when totalReplayMs exceeds the recorded keyframe span (e.g.
      // mouse went idle before the user clicked stop), play keyframes 1:1 and let
      // interpolatePosition hold the last position for the trailing frames rather
      // than time-stretching the recorded motion.
      const scale = sessionDurationMs > 0 ? Math.min(1, totalReplayMs / sessionDurationMs) : 1;

      const totalFrames = Math.ceil(totalReplayMs / frameDurationMs);
      const skipFrames = trimStartMs > 0 ? Math.floor(trimStartMs / frameDurationMs) : 0;

      // Trim window in session frame indices. Glides anchor to these so an
      // extended trim (post-trim or pre-trim recorded content used for
      // crossfade overlap) gets its glide override at the right frames.
      const trimWindowStartFrame = options.trimWindowStartMs != null
        ? Math.floor(options.trimWindowStartMs / frameDurationMs)
        : skipFrames;
      const trimWindowEndFrame = options.trimWindowEndMs != null
        ? Math.min(totalFrames, Math.floor(options.trimWindowEndMs / frameDurationMs))
        : totalFrames;
      const trimWindowFrames = Math.max(0, trimWindowEndFrame - trimWindowStartFrame);

      const entryFrameCount = entryGlide
        ? Math.max(1, Math.min(trimWindowFrames, Math.ceil((entryGlide.durationMs / 1000) * context.fps)))
        : 0;
      const entryStartFrame = entryGlide ? trimWindowStartFrame : -1;
      const entryEndFrame = entryGlide ? trimWindowStartFrame + entryFrameCount : -1;

      const exitFrameCount = exitGlide
        ? Math.max(1, Math.min(trimWindowFrames, Math.ceil((exitGlide.durationMs / 1000) * context.fps)))
        : 0;
      const exitEndFrame = exitGlide ? trimWindowEndFrame : -1;
      const exitStartFrame = exitGlide ? trimWindowEndFrame - exitFrameCount : -1;

      let entryFromPos: CursorPosition | null = null;
      let entryToPos: CursorPosition | null = null;
      let exitFromPos: CursorPosition | null = null;

      let lastPosition: CursorPosition = {
        x: clampCoordinate(Math.round(keyframes[0].x), context.width),
        y: clampCoordinate(Math.round(keyframes[0].y), context.height),
      };

      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        const tFrame = (frameIndex * frameDurationMs) / scale;
        const tPrev = frameIndex === 0 ? -1 : ((frameIndex - 1) * frameDurationMs) / scale;

        const pos = interpolatePosition(positionKeyframes, tFrame);
        const recordedX = clampCoordinate(pos.x, context.width);
        const recordedY = clampCoordinate(pos.y, context.height);

        for (const kf of discreteEventsInWindow(keyframes, tPrev, tFrame)) {
          const ex = clampCoordinate(Math.round(kf.x), context.width);
          const ey = clampCoordinate(Math.round(kf.y), context.height);
          if (kf.event === "click") {
            await context.page.mouse.click(ex, ey);
          } else if (kf.event === "keydown" && kf.key) {
            if (kf.key.length === 1) {
              await context.page.keyboard.type(kf.key);
            } else {
              await context.page.keyboard.press(kf.key);
            }
          }
        }

        if (frameIndex >= skipFrames) {
          let renderX = recordedX;
          let renderY = recordedY;

          // Entry glide takes precedence at the start of the trim window;
          // exit glide kicks in toward the end. They never overlap because
          // the route caps both glide durations at the trim window length.
          if (entryGlide && frameIndex >= entryStartFrame && frameIndex < entryEndFrame) {
            if (frameIndex === entryStartFrame) {
              entryFromPos = { x: entryGlide.fromX, y: entryGlide.fromY };
              if (entryGlide.toX !== undefined && entryGlide.toY !== undefined) {
                entryToPos = { x: entryGlide.toX, y: entryGlide.toY };
              } else {
                // Default target = recorded cursor position at the end of the
                // entry window. This way the glide lands wherever replay
                // would naturally have the cursor immediately after.
                const tEnd = (entryEndFrame * frameDurationMs) / scale;
                const posEnd = interpolatePosition(positionKeyframes, tEnd);
                entryToPos = {
                  x: clampCoordinate(Math.round(posEnd.x), context.width),
                  y: clampCoordinate(Math.round(posEnd.y), context.height),
                };
              }
            }
            const t = Math.min(1, (frameIndex - entryStartFrame + 1) / entryFrameCount);
            const eased = applyGlideStutter(
              applyEasing(t, entryGlide.easing),
              t,
              entryGlide.shape.stutterAmplitude,
              entryGlide.shape.stutterFrequency,
            );
            const pt = arcedGlidePoint(entryFromPos!, entryToPos!, eased, entryGlide.shape.arcFraction);
            renderX = clampCoordinate(Math.round(pt.x), context.width);
            renderY = clampCoordinate(Math.round(pt.y), context.height);
          } else if (exitGlide && frameIndex >= exitStartFrame && frameIndex < exitEndFrame) {
            // Anchor the glide source. If the spec provided an explicit
            // (fromX, fromY) — typically in the crossfade path so it matches
            // the sibling section's glide — use that. Otherwise snapshot the
            // recorded cursor position at the exit-start frame.
            if (frameIndex === exitStartFrame) {
              exitFromPos =
                exitGlide.fromX !== undefined && exitGlide.fromY !== undefined
                  ? { x: exitGlide.fromX, y: exitGlide.fromY }
                  : { x: recordedX, y: recordedY };
            }
            const t = Math.min(1, (frameIndex - exitStartFrame + 1) / exitFrameCount);
            const eased = applyGlideStutter(
              applyEasing(t, exitGlide.easing),
              t,
              exitGlide.shape.stutterAmplitude,
              exitGlide.shape.stutterFrequency,
            );
            const pt = arcedGlidePoint(
              exitFromPos!,
              { x: exitGlide.toX, y: exitGlide.toY },
              eased,
              exitGlide.shape.arcFraction,
            );
            renderX = clampCoordinate(Math.round(pt.x), context.width);
            renderY = clampCoordinate(Math.round(pt.y), context.height);
          }

          // In the capture window — take a screenshot at (renderX, renderY).
          await context.moveAndCapture(renderX, renderY);
          lastPosition = { x: renderX, y: renderY };
        } else {
          // In the skip prefix — advance virtual clock and replay interactions
          // but don't capture a screenshot
          await context.advanceOnly();
          await context.page.mouse.move(recordedX, recordedY, { steps: 1 });
          lastPosition = { x: recordedX, y: recordedY };
        }
      }

      return lastPosition;
    },
  };
}
