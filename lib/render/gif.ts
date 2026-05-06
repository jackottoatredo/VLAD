import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolvedFfmpegPath } from "@/lib/render/render";

const FFMPEG_BIN = resolvedFfmpegPath ?? "ffmpeg";

const DEFAULT_DURATION_SEC = 3;
const DEFAULT_WIDTH = 480;
const PRIMARY_FPS = 12;
const FALLBACK_FPS = 10;
const SIZE_BUDGET_BYTES = 800 * 1024;

type GifOptions = {
  durationSec?: number;
  width?: number;
};

async function runGifEncode(
  videoPath: string,
  outputGifPath: string,
  fps: number,
  durationSec: number,
  width: number,
): Promise<void> {
  // Two-pass palette via filtergraph: split the source, generate a palette
  // from one branch, apply it to the other. Single ffmpeg invocation, no
  // intermediate file.
  const filter =
    `fps=${fps},scale=${width}:-1:flags=lanczos,` +
    `split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;

  const args = [
    "-threads", "1",
    "-i", videoPath,
    "-t", String(durationSec),
    "-vf", filter,
    "-loop", "0",
    "-threads", "1",
    "-y",
    outputGifPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args);
    const stderrLines: string[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrLines.push(chunk.toString());
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg gif exited with code ${code}:\n${stderrLines.join("")}`));
    });
    proc.on("error", reject);
  });
}

export async function extractPreviewGif(
  videoPath: string,
  outputGifPath: string,
  options: GifOptions = {},
): Promise<{ gifPath: string; bytes: number; fps: number }> {
  const durationSec = options.durationSec ?? DEFAULT_DURATION_SEC;
  const width = options.width ?? DEFAULT_WIDTH;

  await runGifEncode(videoPath, outputGifPath, PRIMARY_FPS, durationSec, width);
  let { size } = await stat(outputGifPath);
  let fps = PRIMARY_FPS;

  if (size > SIZE_BUDGET_BYTES) {
    await runGifEncode(videoPath, outputGifPath, FALLBACK_FPS, durationSec, width);
    ({ size } = await stat(outputGifPath));
    fps = FALLBACK_FPS;
    if (size > SIZE_BUDGET_BYTES) {
      console.warn(
        `[gif] preview ${outputGifPath} is ${Math.round(size / 1024)}KB after fps=${FALLBACK_FPS} fallback (budget ${SIZE_BUDGET_BYTES / 1024}KB)`,
      );
    }
  }

  return { gifPath: outputGifPath, bytes: size, fps };
}
