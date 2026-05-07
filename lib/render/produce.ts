import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { renderBackgroundToMp4 } from "@/lib/render/render-background";
import { renderOverlayToWebm } from "@/lib/render/render-overlay";
import { FFMPEG_BIN } from "@/lib/render/ffmpeg-bin";
import { compositeSessionVideo } from "@/lib/compose/compose";
import { type RenderAction } from "@/lib/render/actions";
import type { RenderSpec } from "@/lib/render/spec";
import { uploadToR2, VLAD_NAMESPACE } from "@/lib/storage/r2";
import { computeCursorPositions } from "@/lib/render/cursor-track";
import type { Keyframe } from "@/lib/render/keyframes";

const CURSOR_SVG_PATH = path.join(process.cwd(), "public", "cursor.svg");
const CURSOR_SIZE_PX = 32;
let cursorSourceCache: Buffer | null = null;
function loadCursorSource(): Buffer {
  if (cursorSourceCache) return cursorSourceCache;
  cursorSourceCache = readFileSync(CURSOR_SVG_PATH);
  return cursorSourceCache;
}

export type ProduceOptions = {
  userId: string;
  sessionName: string;
  url: string;
  width: number;
  height: number;
  videoWidth?: number;
  videoHeight?: number;
  zoom?: number;
  fps: number;
  durationMs: number;
  actions: RenderAction[];
  /** Combined render progress — average of background + overlay lanes. */
  onRenderProgress?: (rendered: number, total: number) => void;
  /** Per-lane progress for the background browser pass. Optional; used by
   *  the worker to populate the JobStep.subTasks UI. */
  onBackgroundProgress?: (rendered: number, total: number) => void;
  /** Per-lane progress for the overlay browser pass. */
  onOverlayProgress?: (rendered: number, total: number) => void;
  onRenderComplete?: () => void;
  onComposeProgress?: (step: number, total: number) => void;
  /** Resolved render spec — drives the overlay (webcam, throb, morph) and trim. */
  spec: RenderSpec;
  settleHint?: { x: number; y: number };

  /** Webcam file — absolute temp path (downloaded from R2 by caller). Null if no webcam.
   *  Used for AUDIO MUX only — the visual stream comes from `webcamFrames`. */
  webcamPath?: string | null;

  /** Pre-extracted webcam frames (JPEGs) the overlay shows per render frame.
   *  Null when no webcam. */
  webcamFrames?: Buffer[] | null;

  /** Pre-baked amplitude samples for throb. Null when no audio. */
  amplitudeSamples?: number[] | null;

  /** Recorded mouse keyframes — drive the cursor sprite track. */
  keyframes?: ReadonlyArray<Keyframe>;

  // Warm-start: skip expensive stages by providing cached R2 keys + local paths.
  startFromStep?: 1 | 2 | 3;
  existingBackgroundR2Key?: string;
  existingBackgroundPath?: string;
  existingOverlayR2Key?: string;
  existingOverlayPath?: string;
  existingRenderDurationMs?: number;
  existingCompositeR2Key?: string;
  existingCompositeOutputPath?: string;

  // Quality tier — preview reduces render DPR + ffmpeg downscale.
  preview?: boolean;
};

export type ProduceResult = {
  /** Render-stage artifact: background-only MP4 (page screenshots, no overlay/cursor). */
  backgroundR2Key: string;
  /** Render-stage artifact: transparent overlay webm (webcam circle / audio icon). */
  overlayR2Key: string;
  renderDurationMs: number;
  compositeR2Key: string;
  trimmedR2Key: string | null;
  finalR2Key: string;
  /** Local path of the final video on disk — caller is responsible for cleanup. */
  finalPath: string;
};

async function trimVideoFile(
  composedPath: string,
  userId: string,
  sessionName: string,
  trimStartSec: number | undefined,
  trimEndSec: number | undefined,
): Promise<{ trimmedR2Key: string; trimmedPath: string } | null> {
  const startSec = trimStartSec != null && trimStartSec > 0 ? trimStartSec : 0;
  const hasEnd = trimEndSec != null && trimEndSec > 0;
  if (startSec === 0 && !hasEnd) return null;

  const trimmedName = `${sessionName}-trimmed-${Date.now()}-${randomUUID().slice(0, 8)}.mp4`;
  const trimmedPath = path.join(path.dirname(composedPath), trimmedName);
  const r2Key = `${VLAD_NAMESPACE}/trims/${userId}/${sessionName}/${trimmedName}`;

  // Frame-accurate trim via re-encode (see prior commit history for why
  // -c copy with fast-seek desyncs the webcam audio).
  const args: string[] = ["-threads", "1"];
  if (startSec > 0) args.push("-ss", String(startSec));
  args.push("-i", composedPath);
  if (hasEnd) args.push("-t", String(trimEndSec! - startSec));
  args.push(
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-ar", "48000",
    "-ac", "2",
    "-movflags", "+faststart",
    "-threads", "1",
    "-y",
    trimmedPath,
  );

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args);
    const stderrLines: string[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => { stderrLines.push(chunk.toString()); });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg trim exited with code ${code}:\n${stderrLines.join("")}`));
    });
    proc.on("error", reject);
  });

  const buffer = await readFile(trimmedPath);
  await uploadToR2(r2Key, buffer, "video/mp4");

  return { trimmedR2Key: r2Key, trimmedPath };
}

export async function produceSessionVideo(options: ProduceOptions): Promise<ProduceResult> {
  const step = options.startFromStep ?? 1;

  // ---- Stage 1: parallel layered render ----
  // Two browser contexts run concurrently in this process: one captures
  // the page WITHOUT overlay/cursor (background.mp4), the other captures
  // ONLY the overlay on a transparent canvas (overlay.webm). The cursor
  // is computed deterministically and overlaid by FFmpeg in stage 2.
  let backgroundR2Key: string;
  let backgroundPath: string;
  let overlayR2Key: string;
  let overlayPath: string;
  let renderDurationMs: number;

  if (step <= 1) {
    // Combined progress = average of bg + ov pass progress so the parent
    // step bar advances smoothly while two passes run in parallel.
    let bgPct = 0;
    let ovPct = 0;
    const reportRender = () => {
      const avg = Math.round((bgPct + ovPct) / 2);
      options.onRenderProgress?.(avg, 100);
    };

    const [bgResult, ovResult] = await Promise.all([
      renderBackgroundToMp4({
        url: options.url,
        userId: options.userId,
        sessionName: options.sessionName,
        width: options.width,
        height: options.height,
        videoWidth: options.videoWidth,
        videoHeight: options.videoHeight,
        zoom: options.zoom,
        fps: options.fps,
        durationMs: options.durationMs,
        actions: options.actions,
        settleHint: options.settleHint,
        preview: options.preview,
        onProgress(rendered, total) {
          bgPct = total > 0 ? Math.round((rendered / total) * 100) : 0;
          options.onBackgroundProgress?.(rendered, total);
          reportRender();
        },
      }),
      renderOverlayToWebm({
        userId: options.userId,
        sessionName: options.sessionName,
        width: options.width,
        height: options.height,
        videoWidth: options.videoWidth,
        videoHeight: options.videoHeight,
        zoom: options.zoom,
        fps: options.fps,
        durationMs: options.durationMs,
        spec: options.spec,
        webcamFrames: options.webcamFrames,
        amplitudeSamples: options.amplitudeSamples,
        preview: options.preview,
        onProgress(rendered, total) {
          ovPct = total > 0 ? Math.round((rendered / total) * 100) : 0;
          options.onOverlayProgress?.(rendered, total);
          reportRender();
        },
      }),
    ]);

    backgroundR2Key = bgResult.videoUrl;
    backgroundPath = bgResult.outputPath;
    overlayR2Key = ovResult.videoUrl;
    overlayPath = ovResult.outputPath;
    // Use the background's duration as the canonical render duration —
    // the overlay pass derives its frame count from the same fps so they
    // should match exactly, but the background runs the action chain and
    // is the source of truth for scene length.
    renderDurationMs = bgResult.totalDurationMs;
    options.onRenderComplete?.();
  } else {
    backgroundR2Key = options.existingBackgroundR2Key!;
    backgroundPath = options.existingBackgroundPath!;
    overlayR2Key = options.existingOverlayR2Key!;
    overlayPath = options.existingOverlayPath!;
    renderDurationMs = options.existingRenderDurationMs!;
  }

  // ---- Stage 2: layered compose (background + overlay + cursor + audio) ----
  let compositeR2Key: string;
  let compositeOutputPath: string;

  if (step <= 2) {
    const fps = options.fps;
    const totalRenderFrames = Math.max(1, Math.round((renderDurationMs / 1000) * fps));
    const canvasWidth = options.videoWidth ?? options.width;
    const canvasHeight = options.videoHeight ?? options.height;

    let cursorPositions: { x: number; y: number }[] | undefined;
    if (options.keyframes && options.keyframes.length > 0) {
      cursorPositions = computeCursorPositions({
        keyframes: options.keyframes,
        fps,
        width: canvasWidth,
        height: canvasHeight,
        totalFrames: totalRenderFrames,
        trimStartMs: options.spec.trim?.startSec
          ? options.spec.trim.startSec * 1000
          : undefined,
        trimEndMs: options.spec.trim?.endSec ? options.spec.trim.endSec * 1000 : undefined,
        mouseTrack: options.spec.mouseTrack,
      });
    }

    const composeResult = await compositeSessionVideo({
      userId: options.userId,
      sessionName: options.sessionName,
      backgroundVideoPath: backgroundPath,
      overlayVideoPath: overlayPath,
      durationMs: renderDurationMs,
      onProgress: options.onComposeProgress ?? (() => {}),
      webcamPath: options.webcamPath,
      muteAudio: options.spec.webcam.mode === "off",
      cursorPositions,
      cursorSource: cursorPositions ? loadCursorSource() : undefined,
      cursorSizePx: cursorPositions ? CURSOR_SIZE_PX : undefined,
      canvasWidth: cursorPositions ? canvasWidth : undefined,
      canvasHeight: cursorPositions ? canvasHeight : undefined,
      fps: cursorPositions ? fps : undefined,
    });
    compositeR2Key = composeResult.r2Key;
    compositeOutputPath = composeResult.outputPath;
  } else {
    compositeR2Key = options.existingCompositeR2Key!;
    compositeOutputPath = options.existingCompositeOutputPath!;
  }

  // ---- Stage 3: trim (final encode) ----
  const trim = options.spec.trim;
  const trimResult = await trimVideoFile(
    compositeOutputPath,
    options.userId,
    options.sessionName,
    trim?.startSec,
    trim?.endSec,
  );

  const finalR2Key = trimResult?.trimmedR2Key ?? compositeR2Key;
  const finalPath = trimResult?.trimmedPath ?? compositeOutputPath;

  return {
    backgroundR2Key,
    overlayR2Key,
    renderDurationMs,
    compositeR2Key,
    trimmedR2Key: trimResult?.trimmedR2Key ?? null,
    finalR2Key,
    finalPath,
  };
}
