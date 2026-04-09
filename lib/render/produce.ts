import { renderUrlToMp4 } from "@/lib/render/render";
import { compositeSessionVideo } from "@/lib/compose/compose";
import { type RenderAction } from "@/lib/render/actions";

export type ProduceOptions = {
  presenter: string;
  sessionName: string;
  url: string;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  actions: RenderAction[];
  onRenderProgress?: (rendered: number, total: number) => void;
  onRenderComplete?: () => void;
  onComposeProgress?: (step: number, total: number) => void;
};

export type ProduceResult = {
  videoUrl: string;
};

export async function produceSessionVideo(options: ProduceOptions): Promise<ProduceResult> {
  const renderResult = await renderUrlToMp4({
    url: options.url,
    presenter: options.presenter,
    sessionName: options.sessionName,
    width: options.width,
    height: options.height,
    fps: options.fps,
    durationMs: options.durationMs,
    actions: options.actions,
    onProgress: options.onRenderProgress,
  });

  options.onRenderComplete?.();

  const composeResult = await compositeSessionVideo({
    presenter: options.presenter,
    sessionName: options.sessionName,
    screenVideoPath: renderResult.outputPath,
    screenVideoUrl: renderResult.videoUrl,
    durationMs: renderResult.totalDurationMs,
    onProgress: options.onComposeProgress ?? (() => {}),
  });

  return { videoUrl: composeResult.videoUrl };
}
