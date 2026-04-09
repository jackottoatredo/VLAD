import path from "node:path";

export type ComposeOptions = {
  sessionName: string;
  screenVideoPath: string;   // absolute fs path to the Puppeteer MP4 — ffmpeg input 1
  screenVideoUrl: string;    // public URL of the screen recording — returned as-is by the dummy
  onProgress: (step: number, total: number) => void;
};

export type ComposeResult = {
  videoUrl: string;
};

// Derives the absolute path to the webcam recording for this session.
export function webcamVideoPath(sessionName: string): string {
  return path.join(
    process.cwd(),
    "public",
    "sessions",
    sessionName,
    "recordings",
    `${sessionName}_webcam.webm`
  );
}

export async function compositeSessionVideo(options: ComposeOptions): Promise<ComposeResult> {
  const { onProgress, screenVideoUrl } = options;

  // TODO: replace with real FFmpeg compositing.
  // Inputs available:
  //   options.screenVideoPath  — Puppeteer MP4 (H.264, no audio)
  //   webcamVideoPath(options.sessionName)  — webcam WebM (VP9 + Opus audio)
  // Output should be written to the same renderings dir and return a new videoUrl.
  const total = 10;
  for (let i = 1; i <= total; i++) {
    await new Promise<void>((r) => setTimeout(r, 300));
    onProgress(i, total);
  }

  return { videoUrl: screenVideoUrl };
}
