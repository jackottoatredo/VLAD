import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { FFMPEG_BIN } from "@/lib/render/ffmpeg-bin";

export type MergeTransition = {
  /** 'crossfade' overlaps last N ms of intro with first N ms of product. */
  audio: "none" | "crossfade";
  video: "none" | "crossfade";
  durationMs: number;
  /** Duration of the first input (intro) in seconds — used to compute the
   *  xfade `offset`. Caller probes this from the produce result. */
  introDurationSec: number;
};

/**
 * Concatenate two MP4 videos. Optionally applies audio/video crossfade at
 * the boundary. Inputs are assumed to share resolution, FPS, pixel format,
 * sample rate, and channel layout — produce.ts guarantees this.
 *
 * Without `transition` (or with both fields 'none'), uses the concat filter
 * to handle SPS/PPS mismatches between halves transparently.
 *
 * With `audio: 'crossfade'` or `video: 'crossfade'`, builds a filtergraph
 * using `acrossfade` and/or `xfade` at offset = `introDurationSec − durationMs`.
 * Total output duration = intro + product − transitionDurationMs.
 */
export async function mergeVideoFiles(
  video1Path: string,
  video2Path: string,
  outputDir: string,
  outputName: string,
  onProgress?: (pct: number) => void,
  transition?: MergeTransition,
): Promise<{ mergedPath: string }> {
  const fileName = `${outputName}-merged-${Date.now()}-${randomUUID().slice(0, 8)}.mp4`;
  const mergedPath = path.join(outputDir, fileName);

  const audioCross = transition?.audio === "crossfade";
  const videoCross = transition?.video === "crossfade";
  const useCrossfade = audioCross || videoCross;

  let filterComplex: string;
  if (!useCrossfade) {
    // Plain concat — handles format mismatches between halves.
    filterComplex = "[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[outv][outa]";
  } else {
    const t = transition!;
    const dSec = Math.max(0.1, t.durationMs / 1000);
    // xfade `offset` is the position in the first stream where the fade
    // begins. Clamp to >= 0 in case the intro is shorter than the window.
    const offset = Math.max(0, t.introDurationSec - dSec).toFixed(3);

    const parts: string[] = [];
    if (videoCross) {
      parts.push(`[0:v][1:v]xfade=transition=fade:duration=${dSec.toFixed(3)}:offset=${offset}[outv]`);
    } else {
      parts.push(`[0:v:0][1:v:0]concat=n=2:v=1:a=0[outv]`);
    }
    if (audioCross) {
      // acrossfade has no offset arg — it operates on the END of stream 1
      // and START of stream 2 with overlap = duration. The total length is
      // implicit (sum − duration), which lines up with xfade above.
      parts.push(`[0:a][1:a]acrossfade=d=${dSec.toFixed(3)}:c1=tri:c2=tri[outa]`);
    } else {
      parts.push(`[0:a:0][1:a:0]concat=n=2:v=0:a=1[outa]`);
    }
    filterComplex = parts.join(";");
  }

  const args = [
    "-i", video1Path,
    "-i", video2Path,
    "-filter_complex", filterComplex,
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
