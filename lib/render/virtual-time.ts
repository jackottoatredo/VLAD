import { type Page } from "playwright";

export type VirtualTimeClock = {
  /** Advance the browser clock by exactly `ms` milliseconds, firing all due timers and rAF callbacks. */
  advance(ms: number): Promise<void>;
};

/**
 * Install Playwright's built-in fake clock on the page and pause it so time
 * only advances when `clock.advance()` is called.  This controls `Date.now`,
 * `performance.now`, `requestAnimationFrame`, `setTimeout`, `setInterval`,
 * and CSS animations — all via Playwright's first-class Clock API.
 *
 * Must be called **before** `page.goto()` so the clock is active from first load.
 */
export async function installVirtualTimeClock(page: Page): Promise<VirtualTimeClock> {
  await page.clock.install();
  await page.clock.pauseAt(Date.now());

  return {
    async advance(ms: number): Promise<void> {
      await page.clock.runFor(ms);
    },
  };
}
