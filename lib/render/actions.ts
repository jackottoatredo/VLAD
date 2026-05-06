import { type Page } from "playwright";
import { interpolatePosition, discreteEventsInWindow, type Keyframe } from "@/lib/render/keyframes";
import { clampCoordinate } from "@/lib/render/glide-math";

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

export type ReplayActionOptions = {
  trimStartMs?: number;
};

/**
 * Replays recorded keyframes — drives `page.mouse.move` for hover state and
 * fires discrete click/keydown events at recorded positions. The cursor
 * sprite is NOT drawn here; it's composited by FFmpeg in the compose stage
 * from a deterministic per-frame position track (see lib/render/cursor-track.ts
 * and lib/compose/compose.ts).
 *
 * When `trimStartMs > 0`, all events from t=0 to t=trimStartMs are still
 * replayed (so the page reaches the correct state via clicks/keys), but no
 * screenshots are captured during that prefix — the rendered video starts
 * at the trim boundary.
 */
export function createReplayAction(
  keyframes: ReadonlyArray<Keyframe>,
  durationMs: number,
  options: ReplayActionOptions = {},
): RenderAction {
  const trimStartMs = options.trimStartMs ?? 0;
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
      // mouse went idle before the user clicked stop), play keyframes 1:1 and
      // hold the last position rather than time-stretching the recorded motion.
      const scale = sessionDurationMs > 0 ? Math.min(1, totalReplayMs / sessionDurationMs) : 1;

      const totalFrames = Math.ceil(totalReplayMs / frameDurationMs);
      const skipFrames = trimStartMs > 0 ? Math.floor(trimStartMs / frameDurationMs) : 0;

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
          await context.moveAndCapture(recordedX, recordedY);
          lastPosition = { x: recordedX, y: recordedY };
        } else {
          // Skip prefix: replay interactions for state, no screenshot.
          await context.advanceOnly();
          await context.page.mouse.move(recordedX, recordedY, { steps: 1 });
          lastPosition = { x: recordedX, y: recordedY };
        }
      }

      return lastPosition;
    },
  };
}
