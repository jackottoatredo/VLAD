import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { FFMPEG_BIN } from "@/lib/render/ffmpeg-bin";
import { renderCursorFrames } from "@/lib/render/cursor-layer";
import { probeVideoDurationSec } from "@/lib/render/probeDuration";

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
  /** v6: a single overlay video covering the FULL merged output duration.
   *  Rendered by `renderUnifiedMergeOverlay` over the merged timeline so
   *  the morph (mode + position + scale) is a single continuous animation
   *  with no per-section seam at the boundary. Already at output
   *  resolution and duration — no trim/concat at the merge stage. */
  unifiedOverlayPath: string;
  /** Cursor sprite source — Buffer of public/cursor.svg or a PNG. */
  cursorSource: Buffer;
  cursorSizePx: number;
  /** One (x, y) per OUTPUT frame, in output-frame order. Length must equal
   *  the merged output's frame count = (T_intro_trimmed + T_product_trimmed) × fps. */
  cursorPositions: ReadonlyArray<{ x: number; y: number }>;
  onProgress?: (pct: number) => void;
};

/**
 * One-shot layered FFmpeg merge for the dual-section flow.
 *
 *   - Backgrounds: per-section bg MP4 → trim → tpad + xfade (or concat).
 *   - Overlay:     single unified overlay (covers full merged duration,
 *                  rendered by renderUnifiedMergeOverlay). No trim or
 *                  concat — already aligned with the output.
 *   - Cursor:      sprite over the merged result via PNG sequence.
 *   - Audio:       acrossfade with un-trimmed borrowing OR plain concat.
 *
 * Layer order at composite: bg → cursor → overlay (overlay sits on top
 * so it obscures the cursor when they overlap, matching desktop UI
 * semantics).
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
  const args: string[] = ["-threads", "1"];

  // Input 0: intro background MP4.
  args.push("-i", options.intro.backgroundVideoPath);
  // Input 1: product background MP4.
  args.push("-i", options.product.backgroundVideoPath);
  // Input 2: unified overlay MOV (alpha) — full merged duration, no trim.
  args.push("-i", options.unifiedOverlayPath);
  // Input 3: cursor PNG sequence.
  args.push("-framerate", String(fps), "-i", path.join(cursorFramesDir, cursor.pattern));

  // Inputs 4, 5: section audio sources (webcam.webm or silence).
  const introAudioInputIdx = 4;
  const productAudioInputIdx = 5;
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

  // Inputs 6, 7: borrowed audio chunks (only when audio crossfade is on).
  let introAudioTailIdx: number | null = null;
  let productAudioHeadIdx: number | null = null;
  if (audioCross) {
    if (!t.introAudioTailPath || !t.productAudioHeadPath) {
      throw new Error("audio crossfade requires introAudioTailPath and productAudioHeadPath");
    }
    introAudioTailIdx = 6;
    productAudioHeadIdx = 7;
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

  // Trim each background to its trim window. The unified overlay does NOT
  // need trimming — it was rendered for the merged output duration directly.
  // `fps=N` forces CFR after trim+setpts: some FFmpeg builds drop the
  // inferred frame rate to 1/0 (undefined) on the link, which xfade rejects
  // with "inputs needs to be a constant frame rate". Harmless on already-CFR
  // sources.
  parts.push(`[0:v]${trimSuffix(introTrimStart, introTrimEnd)},fps=${fps}[bg0]`);
  parts.push(`[1:v]${trimSuffix(productTrimStart, productTrimEnd)},fps=${fps}[bg1]`);
  // Force yuva420p on the unified overlay branch so alpha survives any
  // FFmpeg pixel-format downcast before the final overlay step.
  parts.push(`[2:v]format=yuva420p[ovin]`);

  // Background merge (xfade or concat).
  if (videoCross) {
    // xfade's offset must be a finite number. When introTrimEnd is 0 the
    // trimmed length is "to end of stream" — Infinity to FFmpeg's trim
    // filter, but we need a concrete duration here. Probe the intro bg.
    let resolvedIntroTrimmedSec = introTrimmedSec;
    if (!Number.isFinite(resolvedIntroTrimmedSec)) {
      const fullSec = await probeVideoDurationSec(options.intro.backgroundVideoPath);
      if (fullSec == null || !Number.isFinite(fullSec)) {
        throw new Error(
          `cannot resolve intro background duration for xfade offset (path=${options.intro.backgroundVideoPath})`,
        );
      }
      resolvedIntroTrimmedSec = fullSec - introTrimStart;
    }
    parts.push(`[bg0]tpad=stop_mode=clone:stop_duration=${halfVideoSec.toFixed(3)}[bg0pad]`);
    parts.push(`[bg1]tpad=start_mode=clone:start_duration=${halfVideoSec.toFixed(3)}[bg1pad]`);
    const xfadeOffsetSec = Math.max(0, resolvedIntroTrimmedSec - halfVideoSec);
    parts.push(
      `[bg0pad][bg1pad]xfade=transition=fade:duration=${videoSec.toFixed(3)}:offset=${xfadeOffsetSec.toFixed(3)}[bgmerged]`,
    );
  } else {
    parts.push(`[bg0][bg1]concat=n=2:v=1:a=0[bgmerged]`);
  }

  // Composite layer order: bg → cursor → overlay. Cursor sits BEHIND the
  // webcam/audio-icon so the overlay obscures it when they overlap (UI on
  // top of cursor — matches desktop semantics). `format=yuv420` on the
  // bg+overlay step keeps alpha-aware blending of the overlay's alpha so
  // the bg+cursor underneath show through.
  parts.push(`[bgmerged][3:v]overlay=0:0:format=auto[bgcursor]`);
  parts.push(`[bgcursor][ovin]overlay=0:0:format=yuv420[v]`);

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
    "-threads", "1",
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
