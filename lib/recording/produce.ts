import { recordUrlToMp4 } from "@/lib/recording/record";
import { compositeSessionVideo } from "@/lib/recording/compose";
import { type RecordingAction } from "@/lib/recording/actions";

export type ProduceOptions = {
  sessionName: string;
  url: string;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  actions: RecordingAction[];
  onRenderProgress?: (rendered: number, total: number) => void;
  onRenderComplete?: () => void;
  onComposeProgress?: (step: number, total: number) => void;
};

export type ProduceResult = {
  videoUrl: string;
};

export async function produceSessionVideo(options: ProduceOptions): Promise<ProduceResult> {
  const renderResult = await recordUrlToMp4({
    url: options.url,
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
    sessionName: options.sessionName,
    screenVideoPath: renderResult.outputPath,
    screenVideoUrl: renderResult.videoUrl,
    onProgress: options.onComposeProgress ?? (() => {}),
  });

  return { videoUrl: composeResult.videoUrl };
}
