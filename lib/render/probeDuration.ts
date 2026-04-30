import { spawn } from "node:child_process";
import { resolvedFfmpegPath } from "@/lib/render/render";

// Probes the duration of a video file by parsing ffmpeg's stderr "Duration:"
// line. Used by the worker to record output length on render_completed events.
//
// We don't ship a separate ffprobe binary — ffmpeg-static only includes
// ffmpeg. Calling `ffmpeg -i <file>` with no output target prints metadata
// (including duration) to stderr and exits non-zero. We deliberately ignore
// the exit code and only fail if the regex doesn't match.
export async function probeVideoDurationSec(filePath: string): Promise<number | null> {
  const ffmpegBin = resolvedFfmpegPath;
  if (!ffmpegBin) return null;

  return new Promise<number | null>((resolve) => {
    const child = spawn(ffmpegBin, ["-i", filePath]);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) {
        resolve(null);
        return;
      }
      const hours = Number(match[1]);
      const mins = Number(match[2]);
      const secs = Number(match[3]);
      const total = hours * 3600 + mins * 60 + secs;
      resolve(Number.isFinite(total) ? total : null);
    });
  });
}
