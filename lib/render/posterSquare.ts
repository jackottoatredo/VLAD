import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolvedFfmpegPath } from "@/lib/render/render";

const FFMPEG_BIN = resolvedFfmpegPath ?? "ffmpeg";

const SQUARE_SIZE = 1200;

// 1200x1200 from the center of frame 1. Caller MUST pass the no-webcam
// render so the og:image isn't a portrait of the presenter — for og cards
// the screen content reads better as a thumbnail. Center-cropped (not
// letterboxed) so the card has no black bars.
export async function extractSquarePoster(
  videoPath: string,
  outputJpgPath: string,
): Promise<{ posterPath: string; bytes: number }> {
  const filter = [
    `crop=ih:ih:(iw-ih)/2:0`,
    `scale=${SQUARE_SIZE}:${SQUARE_SIZE}`,
  ].join(",");

  const args = [
    "-i", videoPath,
    "-vf", filter,
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
