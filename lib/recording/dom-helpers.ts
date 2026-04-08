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

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

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

export function getElementCoordinateById(
  page: Page,
  id: string,
  relativePoint?: RelativePoint,
  timeoutMs?: number
): Promise<DomPoint> {
  return getElementCoordinateBySelector(
    page,
    `[id="${escapeAttributeValue(id)}"]`,
    relativePoint,
    timeoutMs
  );
}

export function getElementCenterById(
  page: Page,
  id: string,
  timeoutMs?: number
): Promise<DomPoint> {
  return getElementCoordinateById(page, id, { x: 0.5, y: 0.5 }, timeoutMs);
}

export function getElementCoordinateByName(
  page: Page,
  name: string,
  relativePoint?: RelativePoint,
  timeoutMs?: number
): Promise<DomPoint> {
  return getElementCoordinateBySelector(
    page,
    `[name="${escapeAttributeValue(name)}"]`,
    relativePoint,
    timeoutMs
  );
}

export function getElementCenterByName(
  page: Page,
  name: string,
  timeoutMs?: number
): Promise<DomPoint> {
  return getElementCoordinateByName(page, name, { x: 0.5, y: 0.5 }, timeoutMs);
}

export function getElementCoordinateByTestId(
  page: Page,
  testId: string,
  relativePoint?: RelativePoint,
  timeoutMs?: number
): Promise<DomPoint> {
  return getElementCoordinateBySelector(
    page,
    `[data-testid="${escapeAttributeValue(testId)}"]`,
    relativePoint,
    timeoutMs
  );
}

export function getElementCenterByTestId(
  page: Page,
  testId: string,
  timeoutMs?: number
): Promise<DomPoint> {
  return getElementCoordinateByTestId(page, testId, { x: 0.5, y: 0.5 }, timeoutMs);
}

export function getElementCoordinateByClass(
  page: Page,
  className: string,
  relativePoint?: RelativePoint,
  timeoutMs?: number
): Promise<DomPoint> {
  return getElementCoordinateBySelector(
    page,
    `[class~="${escapeAttributeValue(className)}"]`,
    relativePoint,
    timeoutMs
  );
}

export function getElementCenterByClass(
  page: Page,
  className: string,
  timeoutMs?: number
): Promise<DomPoint> {
  return getElementCoordinateByClass(page, className, { x: 0.5, y: 0.5 }, timeoutMs);
}
