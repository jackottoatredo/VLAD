import ffmpeg from "fluent-ffmpeg";
import { resolvedFfmpegPath } from "@/lib/render/ffmpeg-bin";

if (resolvedFfmpegPath) {
  ffmpeg.setFfmpegPath(resolvedFfmpegPath);
}

// Re-export so existing importers keep working.
export { resolvedFfmpegPath };

// The legacy combined render-with-overlay (`renderUrlToMp4`) was retired in
// the v4 layered pipeline. Renders now split into two parallel browser
// passes — `lib/render/render-background.ts` for the page-only MP4 and
// `lib/render/render-overlay.ts` for the transparent webcam/audio overlay
// — and the cursor sprite is composited via FFmpeg at the compose stage
// (see `lib/render/cursor-layer.ts` + `lib/compose/compose.ts`). This file
// is kept as the canonical place for shared FFmpeg bootstrap (binary path
// resolution).
