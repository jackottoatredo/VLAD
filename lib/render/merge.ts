import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { resolvedFfmpegPath } from "@/lib/render/render";

const FFMPEG_BIN = resolvedFfmpegPath ?? "ffmpeg";

/**
 * Concatenate two MP4 videos into a single MP4 using ffmpeg's concat filter.
 *
 * We use the concat FILTER (not the concat demuxer) so format differences
 * between the two halves — e.g. render.ts's default libx264 encode vs
 * compose.ts's re-encode, or one half with webcam audio vs the other with
 * synthesized silence — are resolved by decode-and-re-encode instead of
 * rejected for mismatched SPS/PPS.
 */
export async function mergeVideoFiles(
  video1Path: string,
  video2Path: string,
  outputDir: string,
  outputName: string,
  onProgress?: (pct: number) => void,
): Promise<{ mergedPath: string }> {
  const fileName = `${outputName}-merged-${Date.now()}-${randomUUID().slice(0, 8)}.mp4`;
  const mergedPath = path.join(outputDir, fileName);

  const args = [
    "-i", video1Path,
    "-i", video2Path,
    "-filter_complex",
    "[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[outv][outa]",
    "-map", "[outv]",
    "-map", "[outa]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-ar", "48000",
    "-ac", "2",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-y",
    mergedPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args);
    let buf = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const match = line.match(/^out_time=(\d{2}:\d{2}:\d{2}\.\d+)/);
        if (match) {
          // Progress is approximate since we don't know total duration upfront
          // but the caller can treat any non-zero value as progress
          onProgress?.(50);
        }
      }
    });

    const stderrLines: string[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrLines.push(chunk.toString());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`ffmpeg merge exited with code ${code}:\n${stderrLines.join("")}`));
      }
    });

    proc.on("error", reject);
  });

  return { mergedPath };
}
