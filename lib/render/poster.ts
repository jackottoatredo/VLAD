import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolvedFfmpegPath } from "@/lib/render/render";

const FFMPEG_BIN = resolvedFfmpegPath ?? "ffmpeg";

// Frame 1 of the final video. The render pipeline now guarantees a clean
// first frame, so we don't need to skip ahead to dodge a black flash.
export async function extractPoster(
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
      else reject(new Error(`ffmpeg poster exited with code ${code}:\n${stderrLines.join("")}`));
    });
    proc.on("error", reject);
  });

  const { size } = await stat(outputJpgPath);
  return { posterPath: outputJpgPath, bytes: size };
}
