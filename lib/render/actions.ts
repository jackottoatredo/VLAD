import { type Page } from "playwright";
import { interpolatePosition, discreteEventsInWindow, type Keyframe } from "@/lib/render/keyframes";

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
  trimStartMs = 0,
): RenderAction {
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
      const scale = sessionDurationMs > 0 ? totalReplayMs / sessionDurationMs : 1;

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
        const x = clampCoordinate(pos.x, context.width);
        const y = clampCoordinate(pos.y, context.height);

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
          // In the capture window — take a screenshot
          await context.moveAndCapture(x, y);
        } else {
          // In the skip prefix — advance virtual clock and replay interactions
          // but don't capture a screenshot
          await context.advanceOnly();
          await context.page.mouse.move(x, y, { steps: 1 });
        }

        lastPosition = { x, y };
      }

      return lastPosition;
    },
  };
}
