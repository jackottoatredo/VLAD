import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { renderUrlToMp4, resolvedFfmpegPath } from "@/lib/render/render";
import { compositeSessionVideo } from "@/lib/compose/compose";
import { type RenderAction } from "@/lib/render/actions";
import { type WebcamSettings } from "@/types/webcam";
import { uploadToR2 } from "@/lib/storage/r2";
import { VIRTUAL_PREVIEW_SCALE_FACTOR, PREVIEW_DOWNSCALE_FACTOR } from "@/app/config";

const FFMPEG_BIN = resolvedFfmpegPath ?? "ffmpeg";

export type ProduceOptions = {
  presenter: string;
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
  onRenderProgress?: (rendered: number, total: number) => void;
  onRenderComplete?: () => void;
  onComposeProgress?: (step: number, total: number) => void;
  webcamSettings?: WebcamSettings;
  trimStartSec?: number;
  trimEndSec?: number;
  settleHint?: { x: number; y: number };

  // Webcam file — absolute temp path (downloaded from R2 by caller). Null if no webcam.
  webcamPath?: string | null;

  // Warm-start: skip expensive stages by providing cached R2 keys
  startFromStep?: 1 | 2 | 3;
  existingRenderR2Key?: string;
  existingRenderOutputPath?: string;   // local temp path — required if startFromStep >= 2
  existingRenderDurationMs?: number;
  existingCompositeR2Key?: string;
  existingCompositeOutputPath?: string; // local temp path — required if startFromStep >= 3

  // Quality tier — preview reduces render DPR, applies ffmpeg downscale, and shrinks
  // the webcam overlay proportionally so it still fits the smaller screen video.
  preview?: boolean;
};

export type ProduceResult = {
  renderR2Key: string;
  renderDurationMs: number;
  compositeR2Key: string;
  trimmedR2Key: string | null;
  finalR2Key: string;
};

async function trimVideoFile(
  composedPath: string,
  presenter: string,
  sessionName: string,
  trimStartSec: number | undefined,
  trimEndSec: number | undefined,
): Promise<{ trimmedR2Key: string; trimmedPath: string } | null> {
  const startSec = trimStartSec != null && trimStartSec > 0 ? trimStartSec : 0;
  const hasEnd = trimEndSec != null && trimEndSec > 0;
  if (startSec === 0 && !hasEnd) return null;

  const trimmedName = `${sessionName}-trimmed-${Date.now()}-${randomUUID().slice(0, 8)}.mp4`;
  const trimmedPath = path.join(path.dirname(composedPath), trimmedName);
  const r2Key = `trims/${presenter}/${sessionName}/${trimmedName}`;

  // Frame-accurate trim via re-encode. The previous implementation used
  // `-c copy` with fast-seek (`-ss` before `-i`), which keyframe-aligns the
  // cut: video starts at the nearest keyframe ≤ trimStart while audio seeks
  // precisely. For short trims inside the first GOP the video didn't move at
  // all; for longer trims video and audio landed on different offsets,
  // desyncing the webcam overlay from its audio. Re-encoding costs one more
  // pass but gives an exact cut with video and audio aligned.
  const args: string[] = [];
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

  // Upload trimmed video to R2
  const buffer = await readFile(trimmedPath);
  await uploadToR2(r2Key, buffer, "video/mp4");

  return { trimmedR2Key: r2Key, trimmedPath };
}

export async function produceSessionVideo(options: ProduceOptions): Promise<ProduceResult> {
  const step = options.startFromStep ?? 1;

  // ---- Step 1: Playwright render ----
  let renderR2Key: string;
  let renderOutputPath: string;
  let renderDurationMs: number;

  if (step <= 1) {
    const renderResult = await renderUrlToMp4({
      url: options.url,
      presenter: options.presenter,
      sessionName: options.sessionName,
      width: options.width,
      height: options.height,
      videoWidth: options.videoWidth,
      videoHeight: options.videoHeight,
      zoom: options.zoom,
      fps: options.fps,
      durationMs: options.durationMs,
      actions: options.actions,
      onProgress: options.onRenderProgress,
      settleHint: options.settleHint,
      preview: options.preview,
    });
    renderR2Key = renderResult.videoUrl; // now an R2 key
    renderOutputPath = renderResult.outputPath;
    renderDurationMs = renderResult.totalDurationMs;
    options.onRenderComplete?.();
  } else {
    renderR2Key = options.existingRenderR2Key!;
    renderOutputPath = options.existingRenderOutputPath!;
    renderDurationMs = options.existingRenderDurationMs!;
  }

  // ---- Step 2: Webcam composite ----
  let compositeR2Key: string;
  let compositeOutputPath: string;

  if (step <= 2) {
    // In preview mode the screen video is ~1/4 × 1/4 of virtual pixels; shrink the
    // webcam badge by the same factor so it sits correctly and doesn't clip.
    const overlayScaleFactor = options.preview
      ? VIRTUAL_PREVIEW_SCALE_FACTOR / PREVIEW_DOWNSCALE_FACTOR
      : 1;

    const composeResult = await compositeSessionVideo({
      presenter: options.presenter,
      sessionName: options.sessionName,
      screenVideoPath: renderOutputPath,
      durationMs: renderDurationMs,
      onProgress: options.onComposeProgress ?? (() => {}),
      webcamSettings: options.webcamSettings,
      webcamPath: options.webcamPath,
      overlayScaleFactor,
    });
    compositeR2Key = composeResult.r2Key;
    compositeOutputPath = composeResult.outputPath;
  } else {
    compositeR2Key = options.existingCompositeR2Key!;
    compositeOutputPath = options.existingCompositeOutputPath!;
  }

  // ---- Step 3: Trim ----
  const trimResult = await trimVideoFile(
    compositeOutputPath, options.presenter, options.sessionName,
    options.trimStartSec, options.trimEndSec,
  );

  const finalR2Key = trimResult?.trimmedR2Key ?? compositeR2Key;

  return {
    renderR2Key,
    renderDurationMs,
    compositeR2Key,
    trimmedR2Key: trimResult?.trimmedR2Key ?? null,
    finalR2Key,
  };
}
