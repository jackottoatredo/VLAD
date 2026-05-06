import { existsSync } from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const FFMPEG_FILENAME = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

function normalizeBundledRootPath(binaryPath: string): string {
  const rootPrefixPattern = /^([\\/])ROOT([\\/])/;

  if (!rootPrefixPattern.test(binaryPath)) {
    return binaryPath;
  }

  const relativePath = binaryPath
    .replace(rootPrefixPattern, "")
    .replace(/[\\/]/g, path.sep);

  return path.join(process.cwd(), relativePath);
}

function resolveFfmpegBinaryPath(): string | null {
  const candidates = [
    ffmpegPath,
    ffmpegPath ? normalizeBundledRootPath(ffmpegPath) : null,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", FFMPEG_FILENAME),
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export const resolvedFfmpegPath = resolveFfmpegBinaryPath();
export const FFMPEG_BIN = resolvedFfmpegPath ?? "ffmpeg";
