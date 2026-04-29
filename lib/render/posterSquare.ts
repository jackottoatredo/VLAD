import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolvedFfmpegPath } from "@/lib/render/render";

const FFMPEG_BIN = resolvedFfmpegPath ?? "ffmpeg";

// First frame of the source at native resolution (no crop, no scale).
// Caller MUST pass the no-webcam render so the og:image shows screen
// content rather than a portrait of the presenter. File/function names
// are historical — this used to produce a square; the "square" concept
// was dropped in favor of the native 16:9 frame.
export async function extractSquarePoster(
  videoPath: string,
  outputJpgPath: string,
): Promise<{ posterPath: string; bytes: number }> {
  const args = [
    "-i", videoPath,
    "-frames:v", "1",
    "-q:v", "2",
    "-y",
    outputJpgPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args);
    const stderrLines: string[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrLines.push(chunk.toString());
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg square-poster exited with code ${code}:\n${stderrLines.join("")}`));
    });
    proc.on("error", reject);
  });

  const { size } = await stat(outputJpgPath);
  return { posterPath: outputJpgPath, bytes: size };
}
