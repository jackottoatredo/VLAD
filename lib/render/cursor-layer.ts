import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * Render a cursor sprite at frame-indexed positions to a sequence of
 * transparent PNGs. The PNG sequence is consumed by FFmpeg's image2 demuxer
 * (`-framerate FPS -i frames/frame_%04d.png`) as a second input, then
 * composited via `overlay=0:0` over the rendered (cursor-less) base video.
 *
 * Why PNG sequence (not a single video):
 * - Reliable across FFmpeg versions; no `sendcmd`/expression gymnastics.
 * - Each frame is mostly transparent, so file sizes stay small.
 * - Single-pass compose: rendered.mp4 + cursor PNGs + audio → final.mp4.
 *
 * The cursor source is rasterised once from an SVG/PNG buffer; per-frame
 * output is a transparent canvas with the cursor composited at the
 * recorded (x, y).
 */

export type RenderCursorFramesOptions = {
  /** One (x, y) per output frame, in output-frame order. */
  positions: ReadonlyArray<{ x: number; y: number }>;
  /** Cursor sprite source — usually the contents of `public/cursor.svg`
   *  (read with `readFile` and passed in here). PNG buffers also work. */
  cursorSource: Buffer;
  cursorSizePx: number;
  /** Canvas size = output video resolution. */
  canvasWidth: number;
  canvasHeight: number;
  /** Where to write `frame_NNNN.png`. Caller pre-creates and is responsible
   *  for cleanup. */
  framesDir: string;
};

const FRAME_PAD_WIDTH = 6; // supports up to ~999,999 frames

/**
 * Render the cursor sprite onto a transparent canvas at the right offset for
 * each frame, writing PNG files frame_000001.png, frame_000002.png, ... into
 * `framesDir`. Returns the FFmpeg image2 input pattern (e.g. `frame_%06d.png`).
 *
 * Note: FFmpeg's image2 demuxer numbering starts at 1 by default, hence the
 * +1 offset on the index.
 */
export async function renderCursorFrames(
  opts: RenderCursorFramesOptions,
): Promise<{ pattern: string; frameCount: number }> {
  const { positions, cursorSource, cursorSizePx, canvasWidth, canvasHeight, framesDir } = opts;

  await mkdir(framesDir, { recursive: true });

  // Rasterise the cursor sprite ONCE at the target size. Sharp will composite
  // this RGBA buffer onto each transparent canvas. Cheap.
  const cursorRgba = await sharp(cursorSource)
    .resize(cursorSizePx, cursorSizePx, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < positions.length; i++) {
    const { x, y } = positions[i];
    const frameIdx = i + 1; // image2 starts at 1
    const fileName = `frame_${String(frameIdx).padStart(FRAME_PAD_WIDTH, "0")}.png`;
    const outputPath = path.join(framesDir, fileName);

    const png = await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: cursorRgba.data,
          raw: {
            width: cursorRgba.info.width,
            height: cursorRgba.info.height,
            channels: 4,
          },
          left: Math.round(x),
          top: Math.round(y),
        },
      ])
      .png({ compressionLevel: 1 }) // fastest; files are mostly transparent so still tiny
      .toBuffer();

    await writeFile(outputPath, png);
  }

  return {
    pattern: `frame_%0${FRAME_PAD_WIDTH}d.png`,
    frameCount: positions.length,
  };
}
