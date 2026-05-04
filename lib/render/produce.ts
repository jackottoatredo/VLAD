import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { renderUrlToMp4 } from "@/lib/render/render";
import { FFMPEG_BIN } from "@/lib/render/ffmpeg-bin";
import { compositeSessionVideo } from "@/lib/compose/compose";
import { type RenderAction } from "@/lib/render/actions";
import type { RenderSpec } from "@/lib/render/spec";
import { uploadToR2 } from "@/lib/storage/r2";

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
  onRenderProgress?: (rendered: number, total: number) => void;
  onRenderComplete?: () => void;
  onComposeProgress?: (step: number, total: number) => void;
  /** Resolved render spec — drives the DOM overlay (webcam, throb, morph) and trim. */
  spec: RenderSpec;
  settleHint?: { x: number; y: number };

  /** Webcam file — absolute temp path (downloaded from R2 by caller). Null if no webcam. */
  webcamPath?: string | null;

  /** Pre-baked amplitude samples for throb. Null when no audio. */
  amplitudeSamples?: number[] | null;

  // Warm-start: skip expensive stages by providing cached R2 keys
  startFromStep?: 1 | 2 | 3;
  existingRenderR2Key?: string;
  existingRenderOutputPath?: string;
  existingRenderDurationMs?: number;
  existingCompositeR2Key?: string;
  existingCompositeOutputPath?: string;

  // Quality tier — preview reduces render DPR + ffmpeg downscale.
  preview?: boolean;
};

export type ProduceResult = {
  renderR2Key: string;
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
  const r2Key = `trims/${userId}/${sessionName}/${trimmedName}`;

  // Frame-accurate trim via re-encode (see prior commit history for why
  // -c copy with fast-seek desyncs the webcam audio).
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

  const buffer = await readFile(trimmedPath);
  await uploadToR2(r2Key, buffer, "video/mp4");

  return { trimmedR2Key: r2Key, trimmedPath };
}

export async function produceSessionVideo(options: ProduceOptions): Promise<ProduceResult> {
  const step = options.startFromStep ?? 1;

  // ---- Step 1: Playwright render+composite (webcam overlay baked in) ----
  let renderR2Key: string;
  let renderOutputPath: string;
  let renderDurationMs: number;

  if (step <= 1) {
    const renderResult = await renderUrlToMp4({
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
      onProgress: options.onRenderProgress,
      settleHint: options.settleHint,
      preview: options.preview,
      spec: options.spec,
      webcamPath: options.webcamPath,
      amplitudeSamples: options.amplitudeSamples,
    });
    renderR2Key = renderResult.videoUrl;
    renderOutputPath = renderResult.outputPath;
    renderDurationMs = renderResult.totalDurationMs;
    options.onRenderComplete?.();
  } else {
    renderR2Key = options.existingRenderR2Key!;
    renderOutputPath = options.existingRenderOutputPath!;
    renderDurationMs = options.existingRenderDurationMs!;
  }

  // ---- Step 2: Audio mux (formerly the heavyweight composite step) ----
  let compositeR2Key: string;
  let compositeOutputPath: string;

  if (step <= 2) {
    const composeResult = await compositeSessionVideo({
      userId: options.userId,
      sessionName: options.sessionName,
      screenVideoPath: renderOutputPath,
      durationMs: renderDurationMs,
      onProgress: options.onComposeProgress ?? (() => {}),
      webcamPath: options.webcamPath,
    });
    compositeR2Key = composeResult.r2Key;
    compositeOutputPath = composeResult.outputPath;
  } else {
    compositeR2Key = options.existingCompositeR2Key!;
    compositeOutputPath = options.existingCompositeOutputPath!;
  }

  // ---- Step 3: Trim ----
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
    renderR2Key,
    renderDurationMs,
    compositeR2Key,
    trimmedR2Key: trimResult?.trimmedR2Key ?? null,
    finalR2Key,
    finalPath,
  };
}
