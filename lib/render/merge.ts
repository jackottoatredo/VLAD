import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvedFfmpegPath } from "@/lib/render/render";

const FFMPEG_BIN = resolvedFfmpegPath ?? "ffmpeg";

/**
 * Concatenate two MP4 videos into a single MP4 using ffmpeg's concat demuxer.
 *
 * Returns the absolute path and public URL of the merged file.
 */
export async function mergeVideoFiles(
  video1Path: string,
  video2Path: string,
  outputDir: string,
  outputName: string,
  onProgress?: (pct: number) => void,
): Promise<{ mergedPath: string; mergedUrl: string }> {
  const fileName = `${outputName}-merged-${Date.now()}-${randomUUID().slice(0, 8)}.mp4`;
  const mergedPath = path.join(outputDir, fileName);

  // Build a concat list file
  const listPath = path.join(outputDir, `concat-${Date.now()}.txt`);
  const listContent = `file '${video1Path}'\nfile '${video2Path}'\n`;
  await writeFile(listPath, listContent, "utf-8");

  const args = [
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-c", "copy",
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

  // Derive public URL from the output path
  const publicDir = path.join(process.cwd(), "public");
  const mergedUrl = `/${path.relative(publicDir, mergedPath).replace(/\\/g, "/")}`;

  return { mergedPath, mergedUrl };
}
