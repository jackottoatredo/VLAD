import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { FFMPEG_BIN } from "@/lib/render/ffmpeg-bin";
import { uploadToR2 } from "@/lib/storage/r2";

/**
 * The webcam overlay is now rendered into the page via DOM during the
 * Playwright render stage (see lib/render/overlay.ts). This module's only
 * job is muxing audio onto the rendered (silent) MP4.
 *
 * Rendered video → muxed MP4 with webcam audio track (or synthesised
 * silence when no webcam exists). Video stream is COPIED, not re-encoded —
 * mux is fast even for long clips.
 */

export type ComposeOptions = {
  userId: string;
  sessionName: string;
  /** Absolute fs path to the rendered MP4 from lib/render/render.ts. */
  screenVideoPath: string;
  /** Render duration — used to bound silent fallback audio and report progress. */
  durationMs: number;
  onProgress: (step: number, total: number) => void;
  /** Absolute path to webcam.webm on disk (downloaded from R2 by caller). Null when no webcam. */
  webcamPath?: string | null;
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

/**
 * Mux audio onto the rendered (silent) MP4. The video stream is stream-copied
 * so this is fast (~1s for typical clips). When no webcam audio is available,
 * synthesises a stereo silent track of the correct duration so downstream
 * concat is well-defined.
 */
export async function compositeSessionVideo(options: ComposeOptions): Promise<ComposeResult> {
  const { userId, sessionName, screenVideoPath, durationMs, onProgress } = options;
  const webcamPath = options.webcamPath ?? null;
  const hasWebcamAudio = !!webcamPath && existsSync(webcamPath);

  const durationSec = durationMs / 1000;
  const outputDir = path.dirname(screenVideoPath);
  const fileName = `${sessionName}-final-${Date.now()}-${randomUUID().slice(0, 8)}.mp4`;
  const outputPath = path.join(outputDir, fileName);
  const r2Key = `composites/${userId}/${sessionName}/${fileName}`;

  const args: string[] = hasWebcamAudio
    ? [
        "-i", screenVideoPath,
        "-i", webcamPath!,
        "-map", "0:v",
        "-map", "1:a",
        // Stream-copy the rendered video — overlay is already baked in.
        "-c:v", "copy",
        "-c:a", "aac",
        "-ar", "48000",
        "-ac", "2",
        "-movflags", "+faststart",
        // Bound output to the rendered duration so trailing webcam audio is cut.
        "-t", String(durationSec),
        "-progress", "pipe:1",
        "-y",
        outputPath,
      ]
    : [
        "-i", screenVideoPath,
        "-f", "lavfi",
        "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-map", "0:v",
        "-map", "1:a",
        "-c:v", "copy",
        "-c:a", "aac",
        "-ar", "48000",
        "-ac", "2",
        "-t", String(durationSec),
        "-movflags", "+faststart",
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

  const videoBuffer = await readFile(outputPath);
  await uploadToR2(r2Key, videoBuffer, "video/mp4");

  onProgress(100, 100);
  return { r2Key, outputPath };
}
