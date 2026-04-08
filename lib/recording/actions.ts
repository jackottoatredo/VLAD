import { type Page } from "puppeteer";
import { getElementCenterBySelector, getElementCoordinateBySelector } from "@/lib/recording/dom-helpers";

export type CursorPosition = {
  x: number;
  y: number;
};

export type RecordingActionRunContext = {
  page: Page;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  startCursor?: CursorPosition;
  moveAndCapture: (x: number, y: number) => Promise<void>;
};

export type RecordingAction = {
  name: string;
  durationMs: number;
  // Each action receives the previous action's end cursor in context.startCursor
  // and must return its own final cursor position for chaining continuity.
  run: (context: RecordingActionRunContext) => Promise<CursorPosition>;
};

function frameProgress(frameCount: number, frameIndex: number): number {
  if (frameCount <= 1) {
    return 1;
  }

  return frameIndex / (frameCount - 1);
}

function clampCoordinate(value: number, max: number): number {
  return Math.min(Math.max(value, 0), Math.max(max - 1, 0));
}

export function createTopRightToBottomLeftAction(durationMs: number): RecordingAction {
  return {
    name: "top-right-to-bottom-left",
    durationMs,
    async run(context) {
      const startX = context.startCursor
        ? clampCoordinate(context.startCursor.x, context.width)
        : clampCoordinate(context.width - 1, context.width);
      const startY = context.startCursor
        ? clampCoordinate(context.startCursor.y, context.height)
        : clampCoordinate(0, context.height);

      let lastPosition: CursorPosition = { x: startX, y: startY };

      for (let frameIndex = 0; frameIndex < context.frameCount; frameIndex += 1) {
        const progress = frameProgress(context.frameCount, frameIndex);
        const x = Math.round(startX + (0 - startX) * progress);
        const y = Math.round(progress * (context.height - 1));

        const clampedX = clampCoordinate(x, context.width);
        const clampedY = clampCoordinate(y, context.height);

        await context.moveAndCapture(clampedX, clampedY);
        lastPosition = { x: clampedX, y: clampedY };
      }

      return lastPosition;
    },
  };
}

export function createCircleAction(durationMs: number): RecordingAction {
  return {
    name: "circle",
    durationMs,
    async run(context) {
      const centerX = Math.round((context.width - 1) / 2);
      const centerY = Math.round((context.height - 1) / 2);
      const defaultRadius = Math.max(8, Math.round(Math.min(context.width, context.height) * 0.22));
      const maxRadius = Math.max(8, Math.round(Math.min(context.width, context.height) * 0.45));

      const hasStart = Boolean(context.startCursor);
      const startX = hasStart
        ? clampCoordinate(context.startCursor!.x, context.width)
        : centerX;
      const startY = hasStart
        ? clampCoordinate(context.startCursor!.y, context.height)
        : centerY - defaultRadius;

      const startDx = startX - centerX;
      const startDy = startY - centerY;
      const radius = hasStart
        ? Math.min(maxRadius, Math.max(8, Math.round(Math.hypot(startDx, startDy))))
        : defaultRadius;
      const startAngle = hasStart ? Math.atan2(startDy, startDx) : -Math.PI / 2;

      let lastPosition: CursorPosition = { x: startX, y: startY };

      for (let frameIndex = 0; frameIndex < context.frameCount; frameIndex += 1) {
        const progress = frameProgress(context.frameCount, frameIndex);
        const angle = startAngle + progress * Math.PI * 2;
        const x = Math.round(centerX + Math.cos(angle) * radius);
        const y = Math.round(centerY + Math.sin(angle) * radius);

        const clampedX = clampCoordinate(x, context.width);
        const clampedY = clampCoordinate(y, context.height);

        await context.moveAndCapture(clampedX, clampedY);
        lastPosition = { x: clampedX, y: clampedY };
      }

      return lastPosition;
    },
  };
}

export function createSubmitEcommerceSiteAction(site: string): RecordingAction {
  return {
    name: "submit-ecommerce-site",
    durationMs: 1000,
    async run(context) {
      const inputCenter = await getElementCoordinateBySelector(context.page, "#rs-input", {'x':0.05,'y':0.5});

      const cursorX = clampCoordinate(inputCenter.x, context.width);
      const cursorY = clampCoordinate(inputCenter.y, context.height);

      await context.moveAndCapture(cursorX, cursorY);
      await context.page.mouse.click(cursorX, cursorY);
      await context.moveAndCapture(cursorX, cursorY);

      await context.page.focus("#rs-input");

      for (const character of site) {
        await context.page.keyboard.type(character);
        await context.moveAndCapture(cursorX, cursorY);
      }

      const buttonCenter = await getElementCenterBySelector(context.page, "#rs-btn-arrow");

      const buttonCursorX = clampCoordinate(buttonCenter.x, context.width);
      const buttonCursorY = clampCoordinate(buttonCenter.y, context.height);

      await context.moveAndCapture(buttonCursorX, buttonCursorY);

      await Promise.all([
        context.page
          .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 })
          .catch(() => undefined),
        context.page.mouse.click(buttonCursorX, buttonCursorY),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await context.moveAndCapture(buttonCursorX, buttonCursorY);

      const minimumFramesUsed = 4 + site.length;
      for (let frameIndex = minimumFramesUsed; frameIndex < context.frameCount; frameIndex += 1) {
        await context.moveAndCapture(buttonCursorX, buttonCursorY);
      }

      return { x: buttonCursorX, y: buttonCursorY };
    },
  };
}

export function createReturnsAndClaimsAction(): RecordingAction {
  return {
    name: "returns-and-claims",
    durationMs: 1000,
    async run(context) {
      const target = await getElementCoordinateBySelector(
        context.page,
        `[data-product="Returns & Claims"]`,
        { x: 0.8, y: 0.7 }
      );

      const cursorX = clampCoordinate(target.x, context.width);
      const cursorY = clampCoordinate(target.y, context.height);

      await context.moveAndCapture(cursorX, cursorY);
      await context.page.mouse.click(cursorX, cursorY);
      await context.moveAndCapture(cursorX, cursorY);

      for (let frameIndex = 2; frameIndex < context.frameCount; frameIndex += 1) {
        await context.moveAndCapture(cursorX, cursorY);
      }

      return { x: cursorX, y: cursorY };
    },
  };
}

export function createDefaultActions(durationMs: number): RecordingAction[] {
  return [
    createTopRightToBottomLeftAction(durationMs),
    createTopRightToBottomLeftAction(durationMs),
    createCircleAction(durationMs),
    createSubmitEcommerceSiteAction("mammut.com"),
    createReturnsAndClaimsAction(),
  ];
}
