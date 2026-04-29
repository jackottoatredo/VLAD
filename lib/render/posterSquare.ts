import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolvedFfmpegPath } from "@/lib/render/render";

const FFMPEG_BIN = resolvedFfmpegPath ?? "ffmpeg";

// Zoom factor for the og:image. > 1 zooms into the center of frame 1 to
// hide the white rounded border around the rendered video. 1.0 = full
// source frame, 1.3 ≈ 23% trimmed from each edge. Tune until the image
// looks right after platforms with aggressive crops (iMessage, WhatsApp)
// finish their own crop on top.
const POSTER_ZOOM = 1.3;

// File and function names are historical (used to be a square crop). Now
// outputs a frame at the source aspect ratio (16:9) zoomed in by
// POSTER_ZOOM. Caller MUST pass the no-webcam render so the og:image
// shows the screen content, not a portrait of the presenter.
export async function extractSquarePoster(
  videoPath: string,
  outputJpgPath: string,
): Promise<{ posterPath: string; bytes: number }> {
  // Upscale by POSTER_ZOOM, then crop the center back to the source size.
  // Output keeps source dimensions; only the framing changes.
  const filter = `scale=iw*${POSTER_ZOOM}:ih*${POSTER_ZOOM},crop=iw/${POSTER_ZOOM}:ih/${POSTER_ZOOM}`;

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
