import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolvedFfmpegPath } from "@/lib/render/render";

const FFMPEG_BIN = resolvedFfmpegPath ?? "ffmpeg";

const SQUARE_SIZE = 1200;
const POSTER_FRAME_INDEX = 4;

// 1200x1200 with the source frame letterboxed. Apple's recommended og:image
// dimension; renders cleanly in iMessage / WhatsApp / Twitter / Slack /
// LinkedIn / Discord without center-crop artifacts.
export async function extractSquarePoster(
  videoPath: string,
  outputJpgPath: string,
): Promise<{ posterPath: string; bytes: number }> {
  const filter = [
    `select=eq(n\\,${POSTER_FRAME_INDEX})`,
    `scale=${SQUARE_SIZE}:${SQUARE_SIZE}:force_original_aspect_ratio=decrease`,
    `pad=${SQUARE_SIZE}:${SQUARE_SIZE}:(ow-iw)/2:(oh-ih)/2:black`,
  ].join(",");

  const args = [
    "-i", videoPath,
    "-vf", filter,
    "-vframes", "1",
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
