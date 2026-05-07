import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { uploadToR2, VLAD_NAMESPACE } from "@/lib/storage/r2";
import { FFMPEG_BIN } from "@/lib/render/ffmpeg-bin";
import { injectOverlay, tickOverlay } from "@/lib/render/overlay";
import type { RenderSpec } from "@/lib/render/spec";
import { VIRTUAL_PREVIEW_SCALE_FACTOR } from "@/app/config";

export type RenderOverlayOptions = {
  userId: string;
  sessionName: string;
  width: number;
  height: number;
  videoWidth?: number;
  videoHeight?: number;
  zoom?: number;
  fps: number;
  durationMs: number;
  /** Resolved render config for the overlay (drives webcam mode/position,
   *  morph, throb). The trim window is irrelevant here — overlay covers
   *  the full session, just like the background pass. */
  spec: RenderSpec;
  /** Pre-extracted webcam frames (one JPEG per render frame). Null when
   *  the section has no webcam (audio-mode without webcam, or off). */
  webcamFrames?: Buffer[] | null;
  /** Pre-baked amplitude samples [0,1] at `fps`. Null when no audio data. */
  amplitudeSamples?: number[] | null;
  onProgress?: (rendered: number, total: number) => void;
  preview?: boolean;
};

export type RenderOverlayResult = {
  /** R2 key the encoded transparent overlay video was uploaded to. */
  videoUrl: string;
  /** Local fs path of the encoded transparent overlay video. The container
   *  is QuickTime MOV with the PNG codec (`-c:v png`) — alpha is preserved
   *  losslessly, decoding is widely supported, and we sidestep libvpx-vp9
   *  alpha-handling quirks. */
  outputPath: string;
  totalDurationMs: number;
};

/**
 * Render the overlay layer (webcam circle / audio icon) on a transparent
 * canvas — Playwright pass on `about:blank` with `html`/`body` forced
 * transparent via JS, `injectOverlay` runs the per-frame DOM updates, and
 * `page.screenshot({ omitBackground: true, type: "png" })` produces
 * transparent frames. The PNG sequence is packed into a single MOV via the
 * PNG codec so the compose / merge stage can ingest one file input with
 * alpha intact.
 *
 * No actions are run — the overlay's `tickOverlay(frameIdx)` is a pure
 * function of the frame index, so we just iterate `0..totalFrames-1`.
 */
export async function renderOverlayToWebm(
  options: RenderOverlayOptions,
): Promise<RenderOverlayResult> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "videobot-ov-"));
  const framesDir = path.join(tempDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const fileName = `${options.sessionName}-ov-${Date.now()}-${randomUUID().slice(0, 8)}.mov`;
  const outputPath = path.join(tempDir, fileName);
  const r2Key = `${VLAD_NAMESPACE}/renders/${options.userId}/${options.sessionName}/${fileName}`;

  const totalFrames = Math.max(1, Math.round((options.durationMs / 1000) * options.fps));

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

    // about:blank loads with Chromium's default page background; we force
    // transparent on `html` AND `body` via JS so omitBackground:true on the
    // screenshot produces genuinely transparent pixels everywhere except
    // where the overlay div is.
    await page.goto("about:blank", { timeout: 10_000 });
    await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      root.style.background = "transparent";
      root.style.margin = "0";
      body.style.background = "transparent";
      body.style.margin = "0";
    });

    await injectOverlay(
      page,
      {
        spec: options.spec,
        hasWebcam: !!options.webcamFrames && options.webcamFrames.length > 0,
        amplitudeSamples: options.amplitudeSamples ?? null,
        fps: options.fps,
        zoom,
        totalFrames,
      },
      options.webcamFrames ?? null,
    );

    for (let i = 0; i < totalFrames; i++) {
      await tickOverlay(page, i);
      const framePath = path.join(
        framesDir,
        `frame_${String(i + 1).padStart(6, "0")}.png`,
      );
      await page.screenshot({ path: framePath, type: "png", omitBackground: true });
      options.onProgress?.(i + 1, totalFrames);
    }

    await encodeAlphaMov(framesDir, outputPath, options.fps);

    const buffer = await readFile(outputPath);
    await uploadToR2(r2Key, buffer, "video/quicktime");

    return {
      videoUrl: r2Key,
      outputPath,
      totalDurationMs: Math.round((totalFrames / options.fps) * 1000),
    };
  } finally {
    await browser.close();
    await rm(framesDir, { recursive: true, force: true });
  }
}

/**
 * Pack the PNG sequence into a QuickTime MOV with the PNG codec. The PNG
 * codec is essentially a thin wrapper over the per-frame PNG bytes — alpha
 * is preserved exactly. Output file ≈ sum of input PNG sizes.
 */
async function encodeAlphaMov(
  framesDir: string,
  outputPath: string,
  fps: number,
): Promise<void> {
  // -threads 1 on both sides: ffmpeg's PNG encoder calls
  // ff_frame_thread_encoder_init, which can fail with EAGAIN under container
  // pthread/PID pressure. Frame threading buys us nothing for PNG.
  const args = [
    "-threads", "1",
    "-framerate", String(fps),
    "-i", path.join(framesDir, "frame_%06d.png"),
    "-c:v", "png",
    "-pix_fmt", "rgba",
    "-threads", "1",
    "-y",
    outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args);
    const stderrLines: string[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrLines.push(chunk.toString());
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg overlay encode exited with code ${code}:\n${stderrLines.join("")}`));
    });
    proc.on("error", reject);
  });
}
