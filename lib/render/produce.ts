import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { renderUrlToMp4, resolvedFfmpegPath } from "@/lib/render/render";
import { compositeSessionVideo } from "@/lib/compose/compose";
import { type RenderAction } from "@/lib/render/actions";
import { type WebcamSettings } from "@/types/webcam";

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

  // Warm-start: skip expensive stages by providing cached outputs
  startFromStep?: 1 | 2 | 3;
  existingRenderPath?: string;        // absolute filesystem path — required if startFromStep >= 2
  existingRenderUrl?: string;         // public URL — required if startFromStep >= 2
  existingRenderDurationMs?: number;  // required if startFromStep >= 2
  existingCompositePath?: string;     // absolute filesystem path — required if startFromStep >= 3
  existingCompositeUrl?: string;      // public URL — required if startFromStep >= 3
};

export type ProduceResult = {
  renderUrl: string;
  renderPath: string;
  renderDurationMs: number;
  compositeUrl: string;
  compositePath: string;
  trimmedUrl: string | null;
  finalUrl: string;
};

async function trimVideoFile(
  composedPath: string,
  sessionName: string,
  trimStartSec: number | undefined,
  trimEndSec: number | undefined,
): Promise<{ trimmedUrl: string; trimmedPath: string } | null> {
  const hasTrim = (trimStartSec != null && trimStartSec > 0) ||
                  (trimEndSec != null && trimEndSec > 0);
  if (!hasTrim) return null;

  const trimmedName = `${sessionName}-trimmed-${Date.now()}-${randomUUID().slice(0, 8)}.mp4`;
  const renderingsDir = path.dirname(composedPath);
  const trimmedPath = path.join(renderingsDir, trimmedName);

  // Derive public URL from composedPath
  const publicDir = path.join(process.cwd(), "public");
  const relativeDir = path.relative(publicDir, renderingsDir);
  const trimmedUrl = `/${relativeDir}/${trimmedName}`.replace(/\\/g, "/");

  const args = [
    ...(trimStartSec != null && trimStartSec > 0
      ? ["-ss", String(trimStartSec)]
      : []),
    "-i", composedPath,
    ...(trimEndSec != null && trimEndSec > 0
      ? ["-to", String(trimEndSec - (trimStartSec ?? 0))]
      : []),
    "-c", "copy",
    "-movflags", "+faststart",
    "-y",
    trimmedPath,
  ];

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

  return { trimmedUrl, trimmedPath };
}

export async function produceSessionVideo(options: ProduceOptions): Promise<ProduceResult> {
  const step = options.startFromStep ?? 1;

  // ---- Step 1: Playwright render ----
  let renderUrl: string;
  let renderPath: string;
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
    });
    renderUrl = renderResult.videoUrl;
    renderPath = renderResult.outputPath;
    renderDurationMs = renderResult.totalDurationMs;
    options.onRenderComplete?.();
  } else {
    renderUrl = options.existingRenderUrl!;
    renderPath = options.existingRenderPath!;
    renderDurationMs = options.existingRenderDurationMs!;
  }

  // ---- Step 2: Webcam composite ----
  let compositeUrl: string;
  let compositePath: string;

  if (step <= 2) {
    const composeResult = await compositeSessionVideo({
      presenter: options.presenter,
      sessionName: options.sessionName,
      screenVideoPath: renderPath,
      screenVideoUrl: renderUrl,
      durationMs: renderDurationMs,
      onProgress: options.onComposeProgress ?? (() => {}),
      webcamSettings: options.webcamSettings,
    });
    compositeUrl = composeResult.videoUrl;
    compositePath = path.join(process.cwd(), "public", composeResult.videoUrl);
  } else {
    compositeUrl = options.existingCompositeUrl!;
    compositePath = options.existingCompositePath!;
  }

  // ---- Step 3: Trim ----
  const trimResult = await trimVideoFile(
    compositePath, options.sessionName, options.trimStartSec, options.trimEndSec,
  );

  const finalUrl = trimResult?.trimmedUrl ?? compositeUrl;

  return {
    renderUrl,
    renderPath,
    renderDurationMs,
    compositeUrl,
    compositePath,
    trimmedUrl: trimResult?.trimmedUrl ?? null,
    finalUrl,
  };
}
