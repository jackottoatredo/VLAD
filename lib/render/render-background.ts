import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { chromium, type Page } from "playwright";
import { type CursorPosition, type RenderAction } from "@/lib/render/actions";
import { installVirtualTimeClock, type VirtualTimeClock } from "@/lib/render/virtual-time";
import { uploadToR2 } from "@/lib/storage/r2";
import { resolvedFfmpegPath } from "@/lib/render/ffmpeg-bin";
import { VIRTUAL_PREVIEW_SCALE_FACTOR, PREVIEW_DOWNSCALE_FACTOR } from "@/app/config";

if (resolvedFfmpegPath) {
  ffmpeg.setFfmpegPath(resolvedFfmpegPath);
}

export type RenderBackgroundOptions = {
  url: string;
  /** Full R2 prefix where this stage's output lands. Caller is responsible for
   *  building this from `(userId, ownerKind, ownerId, jobId, section?)` —
   *  see lib/storage/r2.ts helpers. The renderer just appends `/bg.mp4`. */
  intermediatesDir: string;
  width: number;
  height: number;
  videoWidth?: number;
  videoHeight?: number;
  zoom?: number;
  fps: number;
  durationMs: number;
  actions: RenderAction[];
  onProgress?: (rendered: number, total: number) => void;
  /** Mouse position used during the settle phase to nudge the page into a
   *  realistic hover state before capture starts. */
  settleHint?: { x: number; y: number };
  /** Reduced DPR + ffmpeg downscale for the preview tier. */
  preview?: boolean;
};

export type RenderBackgroundResult = {
  /** R2 key the encoded MP4 was uploaded to. */
  videoUrl: string;
  /** Local fs path of the encoded MP4. Caller is responsible for cleanup. */
  outputPath: string;
  /** Final video duration in ms (frame count / fps). */
  totalDurationMs: number;
};

/**
 * Render the page WITHOUT the overlay or cursor — JPEG screenshots → MP4.
 * The overlay (webcam circle / audio icon) and cursor sprite are produced
 * by separate passes (render-overlay.ts) and composited later by FFmpeg in
 * the compose / merge stage.
 *
 * `actions` still drive `page.mouse.move` so hover-state events fire on the
 * page during render — only the visible cursor is suppressed (it's not
 * drawn at all here).
 */
export async function renderBackgroundToMp4(
  options: RenderBackgroundOptions,
): Promise<RenderBackgroundResult> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "videobot-bg-"));
  const framesDir = path.join(tempDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const outputPath = path.join(tempDir, "bg.mp4");
  const r2Key = `${options.intermediatesDir}/bg.mp4`;

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const vw = options.videoWidth ?? options.width;
    const vh = options.videoHeight ?? options.height;
    const zoom = options.zoom ?? 1;
    const dpr = options.preview ? zoom * VIRTUAL_PREVIEW_SCALE_FACTOR : zoom;

    const context = await browser.newContext({
      viewport: { width: Math.round(vw / zoom), height: Math.round(vh / zoom) },
      deviceScaleFactor: dpr,
    });
    const page = await context.newPage();

    const clock = await installVirtualTimeClock(page);
    await page.goto(options.url, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    // Enzuzo cookie banner is injected by Cloudflare across the site and the
    // banner script flips inline display:none → visible after load, so we need
    // a stylesheet rule with !important to keep it suppressed during capture.
    await page.addStyleTag({
      content: `
        #ez-cookie-notification,
        [id^="enzuzo-"],
        [class*="enzuzo-"] {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
        html.enzuzo-overflow-hidden,
        body.enzuzo-overflow-hidden {
          overflow: auto !important;
        }
      `,
    });

    // Settle phase — wiggle the mouse near the starting cursor position so
    // hover-gated initialisation runs before capture begins.
    const SETTLE_MS = 4000;
    const SETTLE_STEP_MS = 1000 / (options.fps || 30);
    const settleSteps = Math.ceil(SETTLE_MS / SETTLE_STEP_MS);
    const hintX = options.settleHint?.x ?? Math.round(vw / zoom / 2);
    const hintY = options.settleHint?.y ?? Math.round(vh / zoom / 2);

    for (let i = 0; i < settleSteps; i++) {
      const offsetX = i % 2 === 0 ? 2 : -2;
      const offsetY = i % 4 < 2 ? 1 : -1;
      await page.mouse.move(hintX + offsetX, hintY + offsetY, { steps: 1 });
      await clock.advance(SETTLE_STEP_MS);
    }

    const totalDurationMs = await captureBackgroundFrames(page, framesDir, options, clock);
    await encodeBackgroundVideo(framesDir, outputPath, {
      fps: options.fps,
      durationMs: totalDurationMs,
      preview: options.preview,
    });

    const videoBuffer = await readFile(outputPath);
    await uploadToR2(r2Key, videoBuffer, "video/mp4");

    return { videoUrl: r2Key, outputPath, totalDurationMs };
  } finally {
    await browser.close();
    await rm(framesDir, { recursive: true, force: true });
  }
}

async function captureBackgroundFrames(
  page: Page,
  framesDir: string,
  options: RenderBackgroundOptions,
  clock: VirtualTimeClock,
): Promise<number> {
  const actions = options.actions ?? [];
  if (actions.length === 0) {
    throw new Error("No render actions were provided.");
  }

  const totalFrames = actions.reduce(
    (sum, action) => sum + Math.max(1, Math.round((action.durationMs / 1000) * options.fps)),
    0,
  );

  const frameDurationMs = 1000 / options.fps;

  let renderedFrames = 0;
  let cursorBetweenActions: CursorPosition | undefined;

  for (const action of actions) {
    const frameCount = Math.max(1, Math.round((action.durationMs / 1000) * options.fps));

    cursorBetweenActions = await action.run({
      page,
      width: options.width,
      height: options.height,
      fps: options.fps,
      frameCount,
      startCursor: cursorBetweenActions,
      moveAndCapture: async (x, y) => {
        await clock.advance(frameDurationMs);
        await page.mouse.move(x, y, { steps: 1 });
        renderedFrames += 1;
        options.onProgress?.(renderedFrames, totalFrames);
        const framePath = path.join(
          framesDir,
          `frame_${String(renderedFrames).padStart(4, "0")}.jpeg`,
        );
        await page.screenshot({ path: framePath, type: "jpeg", quality: 80 });
      },
      advanceOnly: async () => {
        await clock.advance(frameDurationMs);
      },
    });
  }

  if (renderedFrames < 1) throw new Error("No frames were rendered.");
  return Math.round((renderedFrames / options.fps) * 1000);
}

async function encodeBackgroundVideo(
  framesDir: string,
  outputPath: string,
  opts: { fps: number; durationMs: number; preview?: boolean },
): Promise<void> {
  if (!resolvedFfmpegPath) {
    throw new Error("Could not locate ffmpeg binary. Ensure ffmpeg-static is installed.");
  }

  const outputOpts = [
    "-c:v libx264",
    "-pix_fmt yuv420p",
    "-movflags +faststart",
    `-t ${opts.durationMs / 1000}`,
  ];
  if (opts.preview) {
    outputOpts.push(
      `-vf scale=trunc(iw/${PREVIEW_DOWNSCALE_FACTOR}/2)*2:trunc(ih/${PREVIEW_DOWNSCALE_FACTOR}/2)*2`,
      "-preset veryfast",
      "-crf 28",
    );
  }

  await new Promise<void>((resolve, reject) => {
    ffmpeg(path.join(framesDir, "frame_%04d.jpeg"))
      .inputFPS(opts.fps)
      .outputOptions(outputOpts)
      .on("end", () => resolve())
      .on("error", (error: Error) => reject(error))
      .save(outputPath);
  });
}
