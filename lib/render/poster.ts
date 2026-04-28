import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolvedFfmpegPath } from "@/lib/render/render";

const FFMPEG_BIN = resolvedFfmpegPath ?? "ffmpeg";

// Frame 5 (zero-indexed n=4) — early enough that the page is rendered, late
// enough to skip the all-black first frame produced by the headless render.
const POSTER_FRAME_INDEX = 4;

export async function extractPosterFrame5(
  videoPath: string,
  outputJpgPath: string,
): Promise<{ posterPath: string; bytes: number }> {
  const args = [
    "-i", videoPath,
    "-vf", `select=eq(n\\,${POSTER_FRAME_INDEX})`,
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
      else reject(new Error(`ffmpeg poster exited with code ${code}:\n${stderrLines.join("")}`));
    });
    proc.on("error", reject);
  });

  const { size } = await stat(outputJpgPath);
  return { posterPath: outputJpgPath, bytes: size };
}
