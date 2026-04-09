import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { resolvedFfmpegPath } from "@/lib/recording/record";
import {
  WEBCAM_OFFSET_MS,
  WEBCAM_OVERLAY_DIAMETER,
  WEBCAM_OVERLAY_PADDING,
  WEBCAM_BORDER_THICKNESS,
  WEBCAM_SHADOW_RADIUS,
  DEFAULT_FPS,
} from "@/lib/config";

// Reuse the same resolved binary path as record.ts (handles /ROOT/ prefix on bundled installs).
const FFMPEG_BIN = resolvedFfmpegPath ?? "ffmpeg";

// Orange border color components (rgb 233 77 30).
const BORDER_R = 233;
const BORDER_G = 77;
const BORDER_B = 30;

export type ComposeOptions = {
  sessionName: string;
  screenVideoPath: string;   // absolute fs path to the Puppeteer MP4 — ffmpeg input 0
  screenVideoUrl: string;    // public URL returned as-is when no webcam exists
  durationMs: number;        // render duration — used to compute progress without ffprobe
  onProgress: (step: number, total: number) => void;
};

export type ComposeResult = {
  videoUrl: string;
};

// Derives the absolute path to the webcam recording for this session.
export function webcamVideoPath(sessionName: string): string {
  return path.join(
    process.cwd(),
    "public",
    "sessions",
    sessionName,
    "recordings",
    `${sessionName}_webcam.webm`
  );
}

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
 * Geometry (all values in virtual pixels, matching lib/config.ts constants):
 *
 *   D         = WEBCAM_OVERLAY_DIAMETER  (120)  — webcam circle diameter
 *   B         = WEBCAM_BORDER_THICKNESS  (4)    — orange ring width
 *   SR        = WEBCAM_SHADOW_RADIUS     (12)   — drop-shadow blur radius
 *   PAD       = WEBCAM_OVERLAY_PADDING   (12)   — gap from video corner
 *   plateSize = D + 2B                   (128)  — orange circle diameter
 *   canvasSize= plateSize + 2SR          (152)  — transparent badge canvas
 *
 * Layer order (bottom → top):
 *   1. Transparent canvas (152×152)
 *   2. Blurred dark shadow circle, shifted 4px down-right
 *   3. Orange border plate circle (128×128)
 *   4. Webcam circle (120×120, center-cropped to fill)
 */
function buildFilterComplex(): string {
  const D   = WEBCAM_OVERLAY_DIAMETER;
  const B   = WEBCAM_BORDER_THICKNESS;
  const SR  = WEBCAM_SHADOW_RADIUS;
  const PAD = WEBCAM_OVERLAY_PADDING;

  const plateSize  = D + 2 * B;          // 128
  const canvasSize = plateSize + 2 * SR; // 152
  const platePos   = SR;                  // 12 — plate top-left within canvas
  const webcamPos  = SR + B;              // 16 — webcam top-left within canvas
  const shadowSigma  = Math.round(SR / 3); // 4
  const shadowOffset = shadowSigma;        // 4 — shadow displacement (down-right)

  // Canvas top-left position on the main video so the plate's outer edge sits PAD px
  // from the bottom-left corner.
  const overlayX = PAD - SR;                          // 0
  const overlayYExpr = `H-${PAD + platePos + plateSize}`; // H-152

  const halfD = D / 2;
  const halfP = plateSize / 2;

  // Per-pixel alpha expressions for geq.
  const circCam   = `if(lte(hypot(X-${halfD},Y-${halfD}),${halfD}),255,0)`;
  const circPlate = `if(lte(hypot(X-${halfP},Y-${halfP}),${halfP}),255,0)`;
  const circShad  = `if(lte(hypot(X-${halfP},Y-${halfP}),${halfP}),180,0)`;

  const fps = DEFAULT_FPS;

  return [
    // 1. Webcam: scale to fill D×D with center crop, apply circular alpha mask.
    `[1:v]scale=${D}:${D}:force_original_aspect_ratio=increase,crop=${D}:${D},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${circCam}'[wc]`,

    // 2. Fully transparent canvas (badge background).
    `color=c=black:s=${canvasSize}x${canvasSize}:r=${fps},format=rgba,geq=r=0:g=0:b=0:a=0[bg]`,

    // 3. Orange border plate (plateSize × plateSize, circular).
    `color=c=black:s=${plateSize}x${plateSize}:r=${fps},format=rgba,geq=r=${BORDER_R}:g=${BORDER_G}:b=${BORDER_B}:a='${circPlate}'[pc]`,

    // 4. Shadow: same-size circle, semi-transparent black, gaussian blurred.
    `color=c=black:s=${plateSize}x${plateSize}:r=${fps},format=rgba,geq=r=0:g=0:b=0:a='${circShad}',gblur=sigma=${shadowSigma}[sc]`,

    // 5. Shadow onto canvas (offset for drop-shadow effect).
    `[bg][sc]overlay=x=${platePos + shadowOffset}:y=${platePos + shadowOffset}:format=auto[b1]`,

    // 6. Orange plate onto canvas.
    `[b1][pc]overlay=x=${platePos}:y=${platePos}:format=auto[b2]`,

    // 7. Circular webcam on top of plate (inside the border ring).
    `[b2][wc]overlay=x=${webcamPos}:y=${webcamPos}:format=auto[badge]`,

    // 8. Badge onto main screen recording.
    `[0:v][badge]overlay=x=${overlayX}:y=${overlayYExpr}[out]`,
  ].join(";");
}

export async function compositeSessionVideo(options: ComposeOptions): Promise<ComposeResult> {
  const { sessionName, screenVideoPath, screenVideoUrl, durationMs, onProgress } = options;
  const webcamPath = webcamVideoPath(sessionName);

  // If no webcam recording exists for this session, skip compositing entirely.
  if (!existsSync(webcamPath)) {
    onProgress(10, 10);
    return { videoUrl: screenVideoUrl };
  }

  const durationSec = durationMs / 1000;
  const renderingsDir = path.dirname(screenVideoPath);
  const fileName = `${sessionName}-final-${Date.now()}-${randomUUID().slice(0, 8)}.mp4`;
  const outputPath = path.join(renderingsDir, fileName);
  const videoUrl = `/sessions/${sessionName}/renderings/${fileName}`;

  const args = [
    "-i", screenVideoPath,                             // [0:v] screen recording, no audio
    "-itsoffset", String(-(WEBCAM_OFFSET_MS / 1000)), // advance webcam timestamps to align with frame 0
    "-i", webcamPath,                                  // [1:v] + [1:a] webcam + mic
    "-filter_complex", buildFilterComplex(),
    "-map", "[out]",
    "-map", "1:a",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-shortest",
    "-progress", "pipe:1",  // structured key=value progress output on stdout
    "-y",                   // overwrite output without interactive prompt
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
        // -progress pipe:1 emits "out_time=HH:MM:SS.ffffff" each progress tick
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

  onProgress(100, 100);
  return { videoUrl };
}
