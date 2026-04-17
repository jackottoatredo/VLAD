import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { resolvedFfmpegPath } from "@/lib/render/render";
import { uploadToR2 } from "@/lib/storage/r2";
import {
  WEBCAM_OVERLAY_DIAMETER,
  WEBCAM_OVERLAY_MARGIN,
  WEBCAM_BORDER_THICKNESS,
  WEBCAM_SHADOW_RADIUS,
  DEFAULT_FPS,
} from "@/app/config";
import { type WebcamSettings, type WebcamVertical, type WebcamHorizontal, DEFAULT_WEBCAM_SETTINGS } from "@/types/webcam";

// Reuse the same resolved binary path as render.ts (handles /ROOT/ prefix on bundled installs).
const FFMPEG_BIN = resolvedFfmpegPath ?? "ffmpeg";

// Orange border color components (rgb 233 77 30).
const BORDER_R = 233;
const BORDER_G = 77;
const BORDER_B = 30;

export type ComposeOptions = {
  presenter: string;
  sessionName: string;
  screenVideoPath: string;   // absolute fs path to the Playwright MP4 — ffmpeg input 0
  screenVideoR2Key: string;  // R2 key returned as-is when no webcam exists
  durationMs: number;        // render duration — used to compute progress without ffprobe
  onProgress: (step: number, total: number) => void;
  webcamSettings?: WebcamSettings;
  /** Absolute path to webcam recording on disk (downloaded from R2 by caller). Null if no webcam. */
  webcamPath?: string | null;
};

export type ComposeResult = {
  r2Key: string;
  outputPath: string;
};

// Parse HH:MM:SS.ffffff timemark into seconds.
function parseTimemark(mark: string): number {
  const parts = mark.match(/(\d{2}):(\d{2}):(\d{2})\.(\d+)/);
  if (!parts) return 0;
  return (
    parseInt(parts[1]) * 3600 +
    parseInt(parts[2]) * 60 +
    parseInt(parts[3]) +
    parseFloat(`0.${parts[4]}`)
  );
}

/**
 * Builds the FFmpeg filter_complex string for the circular webcam badge overlay.
 *
 * Geometry (all values in virtual pixels, matching app/config.ts constants):
 *
 *   D         = WEBCAM_OVERLAY_DIAMETER  (120)  — webcam circle diameter
 *   B         = WEBCAM_BORDER_THICKNESS  (4)    — orange ring width
 *   SR        = WEBCAM_SHADOW_RADIUS     (12)   — drop-shadow blur radius
 *   PAD       = WEBCAM_OVERLAY_MARGIN    (30)   — gap from video edge to plate outer edge
 *   plateSize    = D + 2B                            (128)  — orange plate diameter
 *   shadowSigma  = SR/3                            (4)    — gaussian blur sigma
 *   shadowOffset = shadowSigma                     (4)    — shadow displacement down-right
 *   canvasSize   = plateSize + 2*(SR+shadowOffset) (160)  — transparent badge canvas (fully contains shadow)
 *   platePos     = (canvasSize-plateSize)/2        (16)   — plate top-left within canvas
 *
 * Layer order (bottom → top):
 *   1. Transparent canvas (152×152)
 *   2. Blurred dark shadow circle, shifted 4px down-right
 *   3. Orange border plate circle (128×128)
 *   4. Webcam circle (120×120, center-cropped to fill)
 */
/**
 * Builds the geq alpha expression for a simple microphone icon inside a D×D circle.
 * The icon is white (r=g=b=255) on a dark background; this expression controls alpha.
 *
 * Shapes (all relative to D):
 *   - Mic capsule: pill/ellipse in upper-centre
 *   - Arc: bottom half-ring below capsule
 *   - Stand: vertical line from arc bottom to base
 *   - Base: short horizontal bar at bottom
 */
function micIconAlpha(D: number): string {
  const cx = D / 2;
  const capCy = Math.round(D * 0.38);          // capsule centre Y
  const capRx = Math.round(D * 0.10);          // capsule half-width
  const capRy = Math.round(D * 0.16);          // capsule half-height
  const arcCy = Math.round(D * 0.56);          // arc centre Y
  const arcR  = Math.round(D * 0.14);          // arc radius
  const arcT  = Math.max(Math.round(D * 0.016), 2); // arc thickness
  const stTop = arcCy + arcR;                   // stand top
  const stBot = stTop + Math.round(D * 0.08);  // stand bottom
  const stHW  = Math.max(Math.round(D * 0.016), 2); // stand half-width
  const bY    = stBot;                           // base centre Y
  const bHW   = Math.round(D * 0.07);          // base half-width
  const bHH   = Math.max(Math.round(D * 0.016), 2); // base half-height

  // Each sub-expression evaluates to 0..1 (with antialiased edges).
  const capsule = `clip(1.5-hypot((X-${cx})/${capRx},(Y-${capCy})/${capRy}),0,1)`;
  const arc     = `clip(${arcT}+0.5-abs(hypot(X-${cx},Y-${arcCy})-${arcR}),0,1)*clip(Y-${arcCy},0,1)`;
  const stand   = `clip(${stHW}+0.5-abs(X-${cx}),0,1)*clip(Y-${stTop}+0.5,0,1)*clip(${stBot}-Y+0.5,0,1)`;
  const base    = `clip(${bHW}+0.5-abs(X-${cx}),0,1)*clip(${bHH}+0.5-abs(Y-${bY}),0,1)`;

  return `clip(${capsule}+${arc}+${stand}+${base},0,1)*255`;
}

/**
 * Builds the FFmpeg filter_complex for the webcam badge overlay.
 *
 * When `baseLabel` is provided, it is used as the background video stream
 * instead of `[0:v]`.  This allows prepending a crop+scale step that feeds
 * its output into the badge overlay (e.g. for postprocess compositing).
 */
function buildFilterComplex(vertical: WebcamVertical, horizontal: WebcamHorizontal, mode: 'video' | 'audio' = 'video', baseLabel?: string): string {
  const D   = WEBCAM_OVERLAY_DIAMETER;
  const B   = WEBCAM_BORDER_THICKNESS;
  const SR  = WEBCAM_SHADOW_RADIUS;
  const PAD = WEBCAM_OVERLAY_MARGIN;

  const plateSize    = D + 2 * B;                           //  128 — orange plate diameter
  const shadowSigma  = Math.round(SR / 3);                  //    4 — gaussian blur sigma
  const shadowOffset = shadowSigma;                         //    4 — shadow displacement down-right
  const canvasSize   = plateSize + 2 * (SR + shadowOffset); //  160 — canvas; fully contains shadow bleed
  const platePos     = (canvasSize - plateSize) / 2;        //   16 — plate top-left within canvas
  const webcamPos    = platePos + B;                        //   20 — webcam top-left within canvas

  // Canvas top-left on the main video: plate outer edge sits PAD px from the chosen corner.
  const overlayX = horizontal === 'left'
    ? PAD - platePos
    : `W-${PAD + platePos + plateSize}`;
  const overlayYExpr = vertical === 'bottom'
    ? `H-${PAD + platePos + plateSize}`
    : `${PAD - platePos}`;

  const halfD         = D / 2;
  const halfP         = plateSize / 2;
  // Shadow source image is larger than the plate so gblur has SR px of transparent
  // runway on all sides — the gaussian fades to ~1% before hitting the image edge.
  const shadowImgSize = plateSize + 2 * SR;   // 152
  const shadowHalfImg = shadowImgSize / 2;     //  76 — circle center within shadow image

  // Per-pixel alpha expressions for geq — 1-pixel antialiased circle boundary.
  const circCam   = `clip(${halfD}+0.5-hypot(X-${halfD},Y-${halfD}),0,1)*255`;
  const circPlate = `clip(${halfP}+0.5-hypot(X-${halfP},Y-${halfP}),0,1)*255`;
  // circShad uses shadowHalfImg as center (circle same radius halfP, larger image).
  const circShad  = `clip(${halfP}+0.5-hypot(X-${shadowHalfImg},Y-${shadowHalfImg}),0,1)*180`;

  const fps = DEFAULT_FPS;

  // Step 1 differs by mode: video uses webcam footage, audio generates a mic icon.
  let contentStep: string;
  if (mode === 'video') {
    contentStep = `[1:v]scale=${D}:${D}:force_original_aspect_ratio=increase,crop=${D}:${D},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${circCam}'[wc]`;
  } else {
    // Mic icon: white icon on dark gray (#282828) circle. The luma expression blends
    // background (40) toward white (255) using the icon shape as a mask.
    const micAlpha = micIconAlpha(D);
    const luma = `min(255,40+215*clip(${micAlpha}/255,0,1))`;
    contentStep = `color=c=black:s=${D}x${D}:r=${fps},format=rgba,geq=r='${luma}':g='${luma}':b='${luma}':a='${circCam}'[wc]`;
  }

  return [
    // 1. Content circle (webcam video or mic icon).
    contentStep,

    // 2. Fully transparent canvas (badge background).
    `color=c=black:s=${canvasSize}x${canvasSize}:r=${fps},format=rgba,geq=r=0:g=0:b=0:a=0[bg]`,

    // 3. Orange border plate (plateSize × plateSize, circular).
    `color=c=black:s=${plateSize}x${plateSize}:r=${fps},format=rgba,geq=r=${BORDER_R}:g=${BORDER_G}:b=${BORDER_B}:a='${circPlate}'[pc]`,

    // 4. Shadow: padded source image so blur fades to zero before reaching the image edge.
    `color=c=black:s=${shadowImgSize}x${shadowImgSize}:r=${fps},format=rgba,geq=r=0:g=0:b=0:a='${circShad}',gblur=sigma=${shadowSigma}[sc]`,

    // 5. Shadow onto canvas.
    `[bg][sc]overlay=x=${platePos + shadowOffset - SR}:y=${platePos + shadowOffset - SR}:format=auto[b1]`,

    // 6. Orange plate onto canvas.
    `[b1][pc]overlay=x=${platePos}:y=${platePos}:format=auto[b2]`,

    // 7. Content circle on top of plate (inside the border ring).
    `[b2][wc]overlay=x=${webcamPos}:y=${webcamPos}:format=auto[badge]`,

    // 8. Badge onto main screen recording.
    `[${baseLabel ?? '0:v'}][badge]overlay=x=${overlayX}:y=${overlayYExpr}[out]`,
  ].join(";");
}

export async function compositeSessionVideo(options: ComposeOptions): Promise<ComposeResult> {
  const { presenter, sessionName, screenVideoPath, screenVideoR2Key, durationMs, onProgress } = options;
  const settings = options.webcamSettings ?? DEFAULT_WEBCAM_SETTINGS;
  const webcamPath = options.webcamPath ?? null;

  // Off mode or no webcam file: return screen video as-is.
  if (settings.webcamMode === 'off' || !webcamPath || !existsSync(webcamPath)) {
    onProgress(10, 10);
    return { r2Key: screenVideoR2Key, outputPath: screenVideoPath };
  }

  const durationSec = durationMs / 1000;
  const outputDir = path.dirname(screenVideoPath);
  const fileName = `${sessionName}-final-${Date.now()}-${randomUUID().slice(0, 8)}.mp4`;
  const outputPath = path.join(outputDir, fileName);
  const r2Key = `composites/${presenter}/${sessionName}/${fileName}`;

  const args = [
    "-i", screenVideoPath,
    "-i", webcamPath,
    "-filter_complex", buildFilterComplex(settings.webcamVertical, settings.webcamHorizontal, settings.webcamMode as 'video' | 'audio'),
    "-map", "[out]",
    "-map", "1:a",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-shortest",
    "-progress", "pipe:1",
    "-y",
    outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args);

    if (!proc.stdout) {
      reject(new Error("ffmpeg process has no stdout"));
      return;
    }

    let buf = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const match = line.match(/^out_time=(\d{2}:\d{2}:\d{2}\.\d+)/);
        if (match && durationSec > 0) {
          const elapsed = parseTimemark(match[1]);
          const pct = Math.min(Math.round((elapsed / durationSec) * 100), 99);
          onProgress(pct, 100);
        }
      }
    });

    const stderrLines: string[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrLines.push(chunk.toString());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}:\n${stderrLines.join("")}`));
      }
    });

    proc.on("error", reject);
  });

  // Upload to R2
  const videoBuffer = await readFile(outputPath);
  await uploadToR2(r2Key, videoBuffer, "video/mp4");

  onProgress(100, 100);
  return { r2Key, outputPath };
}

