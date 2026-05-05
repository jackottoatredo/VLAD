import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { FFMPEG_BIN } from "@/lib/render/ffmpeg-bin";

export type MergeTransition = {
  /** 'crossfade' overlaps audio for `audioDurationMs` at the boundary. */
  audio: "none" | "crossfade";
  /** 'crossfade' overlaps video for `videoDurationMs` at the boundary. */
  video: "none" | "crossfade";
  audioDurationMs: number;
  videoDurationMs: number;
  /** Duration of the first input (intro) in seconds — used to compute the
   *  xfade `offset`. Caller probes this from the produce result. */
  introDurationSec: number;
  /** Path to a WAV/audio file containing the un-trimmed audio chunk
   *  immediately AFTER intro's trim_end (length = audioDurationMs / 2 ms).
   *  Required when `audio === 'crossfade'`. */
  introAudioTailPath?: string;
  /** Path to a WAV/audio file containing the un-trimmed audio chunk
   *  immediately BEFORE product's trim_start (length = audioDurationMs / 2 ms).
   *  Required when `audio === 'crossfade'`. */
  productAudioHeadPath?: string;
};

/**
 * Concatenate two MP4 videos with the symmetric merge model.
 *
 * Total output length is always `T_intro + T_product` (where T_x is the
 * input file's actual length). Each transition is symmetric around the
 * boundary, contributing D/2 from each side:
 *
 *   - video crossfade: each input is padded with D/2 frozen frames via
 *     FFmpeg `tpad` (intro tail clones last frame; product head clones
 *     first frame). The xfade window is then D wide centered on the
 *     boundary, with offset = T_intro - D/2 + D/2 = T_intro. Output:
 *     (T_intro + D/2) + (D/2 + T_product) - D = T_intro + T_product.
 *
 *   - audio crossfade: pre-extracted un-trimmed audio chunks (length D/2
 *     each) are appended to intro audio and prepended to product audio.
 *     The acrossfade window is D wide centered on the boundary. Output:
 *     (T_intro + D/2) + (D/2 + T_product) - D = T_intro + T_product.
 *
 * Audio and video durations are independent — the symmetric model has no
 * cross-coupling because each crossfade's width is absorbed entirely by
 * its own padding/borrow.
 *
 * Without crossfade (both 'none'), uses the concat filter to handle format
 * mismatches between halves transparently.
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

  // Extra inputs (audio chunks for crossfade borrowing). Indices are wired
  // into the filtergraph below.
  const extraInputs: string[] = [];
  let introAudioTailIdx: number | null = null;
  let productAudioHeadIdx: number | null = null;
  if (audioCross) {
    if (!transition?.introAudioTailPath || !transition?.productAudioHeadPath) {
      throw new Error(
        "audio crossfade requires introAudioTailPath and productAudioHeadPath",
      );
    }
    introAudioTailIdx = 2 + extraInputs.length;
    extraInputs.push(transition.introAudioTailPath);
    productAudioHeadIdx = 2 + extraInputs.length;
    extraInputs.push(transition.productAudioHeadPath);
  }

  let filterComplex: string;
  if (!useCrossfade) {
    // Plain concat — handles format mismatches between halves.
    filterComplex = "[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[outv][outa]";
  } else {
    const t = transition!;
    const videoSec = Math.max(0.1, t.videoDurationMs / 1000);
    const audioSec = Math.max(0.1, t.audioDurationMs / 1000);
    const halfVideoSec = videoSec / 2;
    const introSec = t.introDurationSec;

    const parts: string[] = [];

    // ---- Video ----
    if (videoCross) {
      // Symmetric tpad: clone last frame on intro tail, first frame on
      // product head, each by halfVideoSec. With input1 length = T_intro
      // + D/2 and input2 length = D/2 + T_product, xfade offset = T_intro
      // - D/2 puts the blend window exactly across [T_intro - D/2,
      // T_intro + D/2] in output time — centered on the boundary.
      // Output length = offset + input2_length = T_intro + T_product.
      const xfadeOffsetSec = Math.max(0, introSec - halfVideoSec);
      parts.push(
        `[0:v]tpad=stop_mode=clone:stop_duration=${halfVideoSec.toFixed(3)}[v0pad]`,
        `[1:v]tpad=start_mode=clone:start_duration=${halfVideoSec.toFixed(3)}[v1pad]`,
        `[v0pad][v1pad]xfade=transition=fade:duration=${videoSec.toFixed(3)}:offset=${xfadeOffsetSec.toFixed(3)}[outv]`,
      );
    } else {
      parts.push(`[0:v:0][1:v:0]concat=n=2:v=1:a=0[outv]`);
    }

    // ---- Audio ----
    if (audioCross) {
      // Borrow un-trimmed audio chunks (D/2 each side) and stitch them
      // around the boundary, then acrossfade the full-length streams.
      // intro_extended  = T_intro + D_a/2
      // product_extended = D_a/2 + T_product
      // acrossfade D_a → output = T_intro + T_product
      parts.push(
        `[0:a][${introAudioTailIdx}:a]concat=n=2:v=0:a=1[a0ext]`,
        `[${productAudioHeadIdx}:a][1:a]concat=n=2:v=0:a=1[a1ext]`,
        `[a0ext][a1ext]acrossfade=d=${audioSec.toFixed(3)}:c1=tri:c2=tri[outa]`,
      );
    } else {
      parts.push(`[0:a:0][1:a:0]concat=n=2:v=0:a=1[outa]`);
    }
    filterComplex = parts.join(";");
  }

  const args = [
    "-i", video1Path,
    "-i", video2Path,
    ...extraInputs.flatMap((p) => ["-i", p]),
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

/**
 * Extract a fixed-length audio chunk from a webcam.webm file, encoded as
 * 48kHz stereo PCM WAV. Used to borrow un-trimmed audio for the symmetric
 * audio crossfade.
 *
 * `startSec` and `durationSec` clamp to the file's available range. If the
 * requested window extends past the file's end, FFmpeg returns whatever
 * exists; the caller is responsible for ensuring the route-layer clamp
 * gives a window that fully fits.
 */
export async function extractAudioChunk(
  inputPath: string,
  outputDir: string,
  startSec: number,
  durationSec: number,
  label: string,
): Promise<string> {
  const fileName = `${label}-${Date.now()}-${randomUUID().slice(0, 8)}.wav`;
  const outputPath = path.join(outputDir, fileName);
  const args = [
    "-ss", startSec.toFixed(3),
    "-i", inputPath,
    "-t", durationSec.toFixed(3),
    "-vn",
    "-ar", "48000",
    "-ac", "2",
    "-c:a", "pcm_s16le",
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
      else reject(new Error(`ffmpeg audio-chunk extract exited with code ${code}:\n${stderrLines.join("")}`));
    });
    proc.on("error", reject);
  });

  return outputPath;
}
