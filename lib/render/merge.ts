import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { FFMPEG_BIN } from "@/lib/render/ffmpeg-bin";
import { renderCursorFrames } from "@/lib/render/cursor-layer";

export type LayeredMergeTransition = {
  /** 'crossfade' overlaps audio for `audioDurationMs` at the boundary. */
  audio: "none" | "crossfade";
  /** 'crossfade' overlaps the BACKGROUND video for `videoDurationMs` at the
   *  boundary. The overlay layer (webcam circle / audio icon) is always
   *  concatenated, never crossfaded — that's the whole point of layering. */
  video: "none" | "crossfade";
  audioDurationMs: number;
  videoDurationMs: number;
  /** Pre-extracted un-trimmed audio chunk (D/2 long) appended to intro
   *  audio for the symmetric audio crossfade. Required when audio==='crossfade'. */
  introAudioTailPath?: string;
  /** Pre-extracted un-trimmed audio chunk (D/2 long) prepended to product
   *  audio for the symmetric audio crossfade. */
  productAudioHeadPath?: string;
};

export type SectionMergeInputs = {
  /** Background-only render — page screenshots, no overlay/cursor. */
  backgroundVideoPath: string;
  /** Transparent overlay webm — webcam circle / audio icon, alpha-aware. */
  overlayVideoPath: string;
  /** Trim window in session-time seconds. Both undefined / 0 → no trim. */
  trimStartSec?: number;
  trimEndSec?: number;
  /** Webcam.webm for audio source. Null when audio is muted (mode='off' or no webcam). */
  webcamPath: string | null;
  /** When true, intro/product audio is silenced regardless of webcamPath. */
  muteAudio: boolean;
};

export type LayeredMergeOptions = {
  outputDir: string;
  outputName: string;
  fps: number;
  width: number;
  height: number;
  intro: SectionMergeInputs;
  product: SectionMergeInputs;
  transition: LayeredMergeTransition;
  /** Cursor sprite source — Buffer of public/cursor.svg or a PNG. */
  cursorSource: Buffer;
  cursorSizePx: number;
  /** One (x, y) per OUTPUT frame, in output-frame order. Length must equal
   *  the merged output's frame count = (T_intro_trimmed + T_product_trimmed) × fps. */
  cursorPositions: ReadonlyArray<{ x: number; y: number }>;
  onProgress?: (pct: number) => void;
};

/**
 * One-shot layered FFmpeg merge for the dual-section flow. Operates on
 * each section's RAW LAYERS (background MP4 + transparent overlay webm),
 * trims them to their windows inside the filtergraph, then composes:
 *
 *   - Backgrounds: tpad + xfade (the wanted blend) OR plain concat.
 *   - Overlays:    plain concat (no crossfade — eliminates the
 *                  webcam-circle dissolve artifact).
 *   - Cursor:      sprite over the merged result via PNG sequence.
 *   - Audio:       acrossfade with un-trimmed borrowing OR plain concat.
 *
 * Output length = T_intro_trimmed + T_product_trimmed always.
 */
export async function composeLayeredMerge(
  options: LayeredMergeOptions,
): Promise<{ mergedPath: string }> {
  const fileName = `${options.outputName}-merged-${Date.now()}-${randomUUID().slice(0, 8)}.mp4`;
  const mergedPath = path.join(options.outputDir, fileName);

  const t = options.transition;
  const audioCross = t.audio === "crossfade";
  const videoCross = t.video === "crossfade";

  const fps = options.fps;
  const videoSec = Math.max(0.1, t.videoDurationMs / 1000);
  const audioSec = Math.max(0.1, t.audioDurationMs / 1000);
  const halfVideoSec = videoSec / 2;

  const introTrimStart = options.intro.trimStartSec ?? 0;
  const introTrimEnd = options.intro.trimEndSec ?? 0;
  const productTrimStart = options.product.trimStartSec ?? 0;
  const productTrimEnd = options.product.trimEndSec ?? 0;
  const introTrimmedSec = (introTrimEnd > 0 ? introTrimEnd : Number.POSITIVE_INFINITY) - introTrimStart;
  // Note: introTrimmedSec may be Infinity when trimEnd is 0 (no end trim) —
  // FFmpeg's `trim=start:end` with end=0 means "to the end of the stream",
  // so we just omit the end clause in that case.

  // ---- Cursor PNG sequence (one frame per OUTPUT frame) ----
  const cursorFramesDir = path.join(options.outputDir, `cursor-${randomUUID().slice(0, 8)}`);
  await mkdir(cursorFramesDir, { recursive: true });
  const cursor = await renderCursorFrames({
    positions: options.cursorPositions,
    cursorSource: options.cursorSource,
    cursorSizePx: options.cursorSizePx,
    canvasWidth: options.width,
    canvasHeight: options.height,
    framesDir: cursorFramesDir,
  });

  // ---- Build inputs + filtergraph ----
  const args: string[] = [];

  // Inputs 0..3: layered video for both sections.
  args.push("-i", options.intro.backgroundVideoPath);
  args.push("-i", options.intro.overlayVideoPath);
  args.push("-i", options.product.backgroundVideoPath);
  args.push("-i", options.product.overlayVideoPath);

  // Input 4: cursor PNG sequence.
  args.push("-framerate", String(fps), "-i", path.join(cursorFramesDir, cursor.pattern));

  // Inputs 5, 6: section audio sources (webcam.webm or silence).
  const introAudioInputIdx = 5;
  const productAudioInputIdx = 6;
  const useIntroAudio = !options.intro.muteAudio && !!options.intro.webcamPath;
  const useProductAudio = !options.product.muteAudio && !!options.product.webcamPath;
  if (useIntroAudio) {
    args.push("-i", options.intro.webcamPath!);
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  }
  if (useProductAudio) {
    args.push("-i", options.product.webcamPath!);
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  }

  // Inputs 7, 8: borrowed audio chunks (only when audio crossfade is on).
  let introAudioTailIdx: number | null = null;
  let productAudioHeadIdx: number | null = null;
  if (audioCross) {
    if (!t.introAudioTailPath || !t.productAudioHeadPath) {
      throw new Error("audio crossfade requires introAudioTailPath and productAudioHeadPath");
    }
    introAudioTailIdx = 7;
    productAudioHeadIdx = 8;
    args.push("-i", t.introAudioTailPath);
    args.push("-i", t.productAudioHeadPath);
  }

  // ---- Filtergraph parts ----
  const parts: string[] = [];

  const trimSuffix = (start: number, end: number): string => {
    let s = `trim=start=${start.toFixed(3)}`;
    if (end > 0) s += `:end=${end.toFixed(3)}`;
    s += ",setpts=PTS-STARTPTS";
    return s;
  };
  const atrimSuffix = (start: number, end: number): string => {
    let s = `atrim=start=${start.toFixed(3)}`;
    if (end > 0) s += `:end=${end.toFixed(3)}`;
    s += ",asetpts=PTS-STARTPTS";
    return s;
  };

  // Trim each section's layers to its window. Force `yuva420p` on the
  // overlay branch BEFORE trim so the trim/concat filters keep the alpha
  // channel intact — otherwise FFmpeg may silently downcast to yuv420p
  // and the merged overlay covers the background as opaque pixels.
  parts.push(`[0:v]${trimSuffix(introTrimStart, introTrimEnd)}[bg0]`);
  parts.push(`[1:v]format=yuva420p,${trimSuffix(introTrimStart, introTrimEnd)}[ov0]`);
  parts.push(`[2:v]${trimSuffix(productTrimStart, productTrimEnd)}[bg1]`);
  parts.push(`[3:v]format=yuva420p,${trimSuffix(productTrimStart, productTrimEnd)}[ov1]`);

  // Background merge (xfade or concat).
  if (videoCross) {
    // Symmetric tpad + xfade. Output length after this stage:
    //   bg0_padded = T_intro + halfV
    //   bg1_padded = halfV + T_product
    //   xfade D=videoSec offset=T_intro - halfV → output = T_intro + T_product
    parts.push(`[bg0]tpad=stop_mode=clone:stop_duration=${halfVideoSec.toFixed(3)}[bg0pad]`);
    parts.push(`[bg1]tpad=start_mode=clone:start_duration=${halfVideoSec.toFixed(3)}[bg1pad]`);
    const xfadeOffsetSec = Math.max(0, introTrimmedSec - halfVideoSec);
    parts.push(
      `[bg0pad][bg1pad]xfade=transition=fade:duration=${videoSec.toFixed(3)}:offset=${xfadeOffsetSec.toFixed(3)}[bgmerged]`,
    );
  } else {
    parts.push(`[bg0][bg1]concat=n=2:v=1:a=0[bgmerged]`);
  }

  // Overlay merge: ALWAYS concat (never crossfade). The user's morph spec
  // already animates the webcam circle within each section's trim window,
  // so the two overlays meet at the boundary in their morph-end states.
  parts.push(`[ov0][ov1]concat=n=2:v=1:a=0[ovmerged]`);

  // Composite: bg + overlay, then + cursor. `format=yuv420` on the bg+ov
  // step picks the alpha-aware blend implementation that respects the
  // overlay's alpha channel. The cursor overlay similarly benefits from
  // alpha-aware blending of the cursor PNG sprite.
  parts.push(`[bgmerged][ovmerged]overlay=0:0:format=yuv420[bgov]`);
  parts.push(`[bgov][4:v]overlay=0:0:format=auto[v]`);

  // Audio: trim each section's audio to its window, then merge.
  parts.push(`[${introAudioInputIdx}:a]${atrimSuffix(introTrimStart, introTrimEnd)}[a0]`);
  parts.push(`[${productAudioInputIdx}:a]${atrimSuffix(productTrimStart, productTrimEnd)}[a1]`);
  if (audioCross) {
    parts.push(`[a0][${introAudioTailIdx}:a]concat=n=2:v=0:a=1[a0ext]`);
    parts.push(`[${productAudioHeadIdx}:a][a1]concat=n=2:v=0:a=1[a1ext]`);
    parts.push(`[a0ext][a1ext]acrossfade=d=${audioSec.toFixed(3)}:c1=tri:c2=tri[outa]`);
  } else {
    parts.push(`[a0][a1]concat=n=2:v=0:a=1[outa]`);
  }

  const filterComplex = parts.join(";");

  args.push(
    "-filter_complex", filterComplex,
    "-map", "[v]",
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
  );

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(FFMPEG_BIN, args);
      let buf = "";
      proc.stdout?.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (/^out_time=/.test(line)) options.onProgress?.(50);
        }
      });
      const stderrLines: string[] = [];
      proc.stderr?.on("data", (chunk: Buffer) => { stderrLines.push(chunk.toString()); });
      proc.on("close", (code) => {
        if (code === 0) {
          options.onProgress?.(100);
          resolve();
        } else {
          reject(new Error(`ffmpeg layered merge exited with code ${code}:\n${stderrLines.join("")}`));
        }
      });
      proc.on("error", reject);
    });
  } finally {
    rm(cursorFramesDir, { recursive: true, force: true }).catch(() => {});
  }

  return { mergedPath };
}

/**
 * Extract a fixed-length audio chunk from a webcam.webm file, encoded as
 * 48kHz stereo PCM WAV. Used to borrow un-trimmed audio for the symmetric
 * audio crossfade.
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
