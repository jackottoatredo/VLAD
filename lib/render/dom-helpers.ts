import { type Page } from "puppeteer";

export type DomPoint = {
  x: number;
  y: number;
};

export type RelativePoint = {
  x: number;
  y: number;
};

const DEFAULT_SELECTOR_TIMEOUT_MS = 10_000;

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, value));
}

function normalizeRelativePoint(relativePoint?: RelativePoint): Required<RelativePoint> {
  return {
    x: clampUnit(relativePoint?.x ?? 0.5),
    y: clampUnit(relativePoint?.y ?? 0.5),
  };
}

export async function getElementCoordinateBySelector(
  page: Page,
  selector: string,
  relativePoint?: RelativePoint,
  timeoutMs: number = DEFAULT_SELECTOR_TIMEOUT_MS
): Promise<DomPoint> {
  const normalized = normalizeRelativePoint(relativePoint);

  await page.waitForSelector(selector, { timeout: timeoutMs });

  return page.$eval(
    selector,
    (element, point) => {
      const rect = (element as HTMLElement).getBoundingClientRect();

      return {
        x: Math.round(rect.left + rect.width * point.x),
        y: Math.round(rect.top + rect.height * point.y),
      };
    },
    normalized
  );
}

export async function getElementCenterBySelector(
  page: Page,
  selector: string,
  timeoutMs: number = DEFAULT_SELECTOR_TIMEOUT_MS
): Promise<DomPoint> {
  return getElementCoordinateBySelector(page, selector, { x: 0.5, y: 0.5 }, timeoutMs);
}
