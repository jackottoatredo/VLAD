import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { FFMPEG_BIN } from "@/lib/render/ffmpeg-bin";
import { uploadToR2 } from "@/lib/storage/r2";
import { renderCursorFrames } from "@/lib/render/cursor-layer";

/**
 * Compose stage: layer (background MP4) + (transparent overlay webm) +
 * (cursor sprite track) and mux audio. Single FFmpeg pass.
 *
 * Filtergraph chain (when all layers present):
 *   [0:v][1:v] overlay=0:0:format=auto         → bg + webcam-overlay
 *               [bg2][2:v] overlay=0:0:format=auto → + cursor sprite
 *               [v]
 *
 * Layer alpha: the overlay webm is encoded with libvpx-vp9 / yuva420p so
 * its alpha channel survives the FFmpeg overlay filter (`format=auto`
 * preserves the input pixel format and respects alpha).
 */

export type ComposeOptions = {
  userId: string;
  sessionName: string;
  /** Background-only render — page screenshots, no overlay/cursor. */
  backgroundVideoPath: string;
  /** Transparent overlay webm — webcam circle / audio icon, alpha-aware. */
  overlayVideoPath: string;
  /** Render duration — bounds silent fallback audio and progress. */
  durationMs: number;
  onProgress: (step: number, total: number) => void;
  /** Absolute path to webcam.webm on disk. Null when no webcam. */
  webcamPath?: string | null;
  /** Synthesise silence regardless of `webcamPath`. Set when the section's
   *  webcam mode is 'off'. */
  muteAudio?: boolean;

  /** One (x, y) cursor position per RENDERED frame, in render-frame order.
   *  When omitted/empty, the cursor sprite layer is skipped. */
  cursorPositions?: ReadonlyArray<{ x: number; y: number }>;
  cursorSource?: Buffer;
  cursorSizePx?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  fps?: number;
};

export type ComposeResult = {
  r2Key: string;
  outputPath: string;
};

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

export async function compositeSessionVideo(options: ComposeOptions): Promise<ComposeResult> {
  const { userId, sessionName, backgroundVideoPath, overlayVideoPath, durationMs, onProgress } = options;
  const webcamPath = options.webcamPath ?? null;
  const hasWebcamAudio = !options.muteAudio && !!webcamPath && existsSync(webcamPath);

  const durationSec = durationMs / 1000;
  const outputDir = path.dirname(backgroundVideoPath);
  const fileName = `${sessionName}-final-${Date.now()}-${randomUUID().slice(0, 8)}.mp4`;
  const outputPath = path.join(outputDir, fileName);
  const r2Key = `composites/${userId}/${sessionName}/${fileName}`;

  const wantsCursorOverlay =
    !!options.cursorPositions &&
    options.cursorPositions.length > 0 &&
    !!options.cursorSource &&
    !!options.cursorSizePx &&
    !!options.canvasWidth &&
    !!options.canvasHeight &&
    !!options.fps;

  // Stage A — generate cursor PNG sequence (only when cursor overlay requested).
  let cursorFramesDir: string | null = null;
  let cursorPattern: string | null = null;
  if (wantsCursorOverlay) {
    cursorFramesDir = path.join(outputDir, `cursor-frames-${randomUUID().slice(0, 8)}`);
    await mkdir(cursorFramesDir, { recursive: true });
    const result = await renderCursorFrames({
      positions: options.cursorPositions!,
      cursorSource: options.cursorSource!,
      cursorSizePx: options.cursorSizePx!,
      canvasWidth: options.canvasWidth!,
      canvasHeight: options.canvasHeight!,
      framesDir: cursorFramesDir,
    });
    cursorPattern = result.pattern;
  }

  // Stage B — single FFmpeg pass: layer composite + audio mux.
  // Input order:
  //   [0] background.mp4
  //   [1] overlay.webm (alpha)
  //   [2] cursor PNG sequence  (only when cursor overlay requested)
  //   [3 or 2] webcam.webm OR anullsrc — the audio source
  const args: string[] = [];

  args.push("-i", backgroundVideoPath);
  args.push("-i", overlayVideoPath);

  if (wantsCursorOverlay) {
    args.push("-framerate", String(options.fps!), "-i", path.join(cursorFramesDir!, cursorPattern!));
  }

  const audioInputIdx = wantsCursorOverlay ? 3 : 2;
  if (hasWebcamAudio) {
    args.push("-i", webcamPath!);
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  }

  // Layer order: bg → cursor → overlay. The cursor sits BEHIND the
  // webcam/audio-icon so the overlay obscures the cursor when they
  // overlap (matches normal desktop behavior — UI in front of cursor).
  // `format=yuva420p` on the overlay branch keeps the alpha intact across
  // the overlay filter so the bg + cursor underneath show through.
  const filter = wantsCursorOverlay
    ? "[1:v]format=yuva420p[ovin];[0:v][2:v]overlay=0:0:format=auto[bgc];[bgc][ovin]overlay=0:0:format=yuv420[v]"
    : "[1:v]format=yuva420p[ovin];[0:v][ovin]overlay=0:0:format=yuv420[v]";

  args.push(
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", `${audioInputIdx}:a`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-ar", "48000",
    "-ac", "2",
    "-movflags", "+faststart",
    "-t", String(durationSec),
    "-progress", "pipe:1",
    "-y",
    outputPath,
  );

  try {
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
  } finally {
    if (cursorFramesDir) {
      rm(cursorFramesDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const videoBuffer = await readFile(outputPath);
  await uploadToR2(r2Key, videoBuffer, "video/mp4");

  onProgress(100, 100);
  return { r2Key, outputPath };
}
