import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FFMPEG_BIN } from "@/lib/render/ffmpeg-bin";
import { uploadToR2, downloadBufferFromR2 } from "@/lib/storage/r2";
import { DEFAULT_FPS } from "@/app/config";

/**
 * VLAD Frame Bundle v1 (VFB1) — a single binary file containing all webcam
 * JPEGs for one recording, frame-indexed by capture order at DEFAULT_FPS.
 *
 * Structure:
 *   [4 bytes]            magic 'VFB1' (UTF-8)
 *   [4 bytes]            fps (uint32 LE)
 *   [4 bytes]            count (uint32 LE)
 *   [count × 4 bytes]    per-frame size (uint32 LE)
 *   [...]                concatenated JPEG payloads
 *
 * Replaces seek-driven webcam playback. By pre-extracting at upload time,
 * render-time becomes deterministic — frame N is always frames[N], no seek
 * required.
 */
const MAGIC = Buffer.from("VFB1", "utf8");
/** JPEG quality (FFmpeg -q:v scale: 1 best, 31 worst). 4 ≈ visually q80-ish, ~30KB at 480px². */
const JPEG_QSCALE = 4;
/** Pre-scale frames to a fixed square resolution. Aligns with the overlay's
 *  circular badge; browser scales down for the actual viewport size. */
const FRAME_SIZE_PX = 480;

export type WebcamFramesBundle = {
  fps: number;
  count: number;
  frames: Buffer[];
};

/**
 * Decode a serialized VFB1 buffer into per-frame views. The returned `frames`
 * buffers are zero-copy slices of the input — keep the input alive while
 * using them.
 */
export function decodeBundle(buf: Buffer): WebcamFramesBundle {
  if (buf.length < 12 || buf.subarray(0, 4).compare(MAGIC) !== 0) {
    throw new Error("Invalid frame bundle magic");
  }
  let off = 4;
  const fps = buf.readUInt32LE(off); off += 4;
  const count = buf.readUInt32LE(off); off += 4;

  const sizes: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    sizes[i] = buf.readUInt32LE(off);
    off += 4;
  }

  const frames: Buffer[] = new Array(count);
  for (let i = 0; i < count; i++) {
    frames[i] = buf.subarray(off, off + sizes[i]);
    off += sizes[i];
  }
  return { fps, count, frames };
}

function encodeBundle(fps: number, frames: Buffer[]): Buffer {
  const headerSize = 4 + 4 + 4 + frames.length * 4;
  const payloadSize = frames.reduce((s, f) => s + f.length, 0);
  const out = Buffer.alloc(headerSize + payloadSize);
  let off = 0;
  MAGIC.copy(out, off); off += 4;
  out.writeUInt32LE(fps, off); off += 4;
  out.writeUInt32LE(frames.length, off); off += 4;
  for (const f of frames) {
    out.writeUInt32LE(f.length, off);
    off += 4;
  }
  for (const f of frames) {
    f.copy(out, off);
    off += f.length;
  }
  return out;
}

/**
 * Extract per-frame JPEGs from a webcam buffer and bundle into a VFB1 file.
 * Frames are sampled at DEFAULT_FPS and pre-scaled to FRAME_SIZE_PX square
 * (center-cropped if the source aspect differs).
 */
export async function extractWebcamFrames(webcamBuffer: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "vlad-frames-"));
  try {
    const inPath = path.join(dir, "webcam.webm");
    await writeFile(inPath, webcamBuffer);

    const framePattern = path.join(dir, "frame_%05d.jpg");
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(FFMPEG_BIN, [
        "-loglevel", "error",
        "-i", inPath,
        "-vf",
        `fps=${DEFAULT_FPS},scale=${FRAME_SIZE_PX}:${FRAME_SIZE_PX}:force_original_aspect_ratio=increase,crop=${FRAME_SIZE_PX}:${FRAME_SIZE_PX}`,
        "-q:v", String(JPEG_QSCALE),
        "-y",
        framePattern,
      ]);
      const stderr: string[] = [];
      proc.stderr?.on("data", (c: Buffer) => stderr.push(c.toString()));
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg frame extract exited ${code}: ${stderr.join("")}`));
      });
      proc.on("error", reject);
    });

    const files = (await readdir(dir))
      .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
      .sort();
    const frames: Buffer[] = [];
    for (const f of files) {
      frames.push(await readFile(path.join(dir, f)));
    }
    return encodeBundle(DEFAULT_FPS, frames);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Canonical R2 key for a webcam's frame bundle, derived from the webcam key. */
export function bundleKeyForWebcam(webcamR2Key: string): string {
  return webcamR2Key.replace(/\.webm$/i, ".frames.bin");
}

/**
 * Idempotently bake the frame bundle for a webcam at the given R2 key.
 * Returns the bundle R2 key. Skip if bundle already present.
 */
export async function bakeWebcamFramesForUpload(webcamR2Key: string): Promise<string> {
  const bundleKey = bundleKeyForWebcam(webcamR2Key);
  if (bundleKey === webcamR2Key) {
    throw new Error(`Cannot derive bundle key from non-webm key: ${webcamR2Key}`);
  }
  try {
    await downloadBufferFromR2(bundleKey);
    return bundleKey;
  } catch {
    /* not present — bake */
  }
  const webcamBuffer = await downloadBufferFromR2(webcamR2Key);
  const bundle = await extractWebcamFrames(webcamBuffer);
  await uploadToR2(bundleKey, bundle, "application/octet-stream");
  return bundleKey;
}

/** Fetch bundle from R2 and decode. Returns null on miss. */
export async function fetchWebcamFrames(webcamR2Key: string): Promise<WebcamFramesBundle | null> {
  try {
    const buf = await downloadBufferFromR2(bundleKeyForWebcam(webcamR2Key));
    return decodeBundle(buf);
  } catch {
    return null;
  }
}
