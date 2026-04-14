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
  trimStartSec?: number;   // trim the final composited video (not the replay)
  trimEndSec?: number;
};

export type ProduceResult = {
  videoUrl: string;
};

export async function produceSessionVideo(options: ProduceOptions): Promise<ProduceResult> {
  // 1. Render full mouse interaction via Playwright
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

  options.onRenderComplete?.();

  // 2. Composite webcam overlay onto the full render
  const composeResult = await compositeSessionVideo({
    presenter: options.presenter,
    sessionName: options.sessionName,
    screenVideoPath: renderResult.outputPath,
    screenVideoUrl: renderResult.videoUrl,
    durationMs: renderResult.totalDurationMs,
    onProgress: options.onComposeProgress ?? (() => {}),
    webcamSettings: options.webcamSettings,
  });

  // 3. Trim the final video if trim marks are set
  const hasTrim = (options.trimStartSec != null && options.trimStartSec > 0) ||
                  (options.trimEndSec != null && Number.isFinite(options.trimEndSec));

  if (!hasTrim) {
    return { videoUrl: composeResult.videoUrl };
  }

  const composedPath = path.join(
    process.cwd(), "public", composeResult.videoUrl,
  );
  const trimmedName = `${options.sessionName}-trimmed-${Date.now()}-${randomUUID().slice(0, 8)}.mp4`;
  const renderingsDir = path.dirname(composedPath);
  const trimmedPath = path.join(renderingsDir, trimmedName);
  const trimmedUrl = composeResult.videoUrl.replace(/[^/]+$/, trimmedName);

  const args = [
    ...(options.trimStartSec != null && options.trimStartSec > 0
      ? ["-ss", String(options.trimStartSec)]
      : []),
    "-i", composedPath,
    ...(options.trimEndSec != null && Number.isFinite(options.trimEndSec)
      ? ["-to", String(options.trimEndSec - (options.trimStartSec ?? 0))]
      : []),
    "-c", "copy",          // stream copy — no re-encode, nearly instant
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

  return { videoUrl: trimmedUrl };
}
