import { spawn } from "node:child_process";
import { FFMPEG_BIN } from "@/lib/render/ffmpeg-bin";
import { uploadToR2, downloadBufferFromR2 } from "@/lib/storage/r2";
import { DEFAULT_FPS } from "@/app/config";

const SAMPLE_RATE = 48_000;

export type AmplitudeTrack = {
  fps: number;
  /** Normalized peak-relative RMS in [0, 1], one entry per video frame at `fps`. */
  samples: number[];
};

/**
 * Decode `audioBuffer` (any format ffmpeg accepts) to mono PCM at 48 kHz, then
 * compute peak-normalized RMS amplitude per video frame at DEFAULT_FPS.
 *
 * Silent tracks return all zeros. Throws if ffmpeg fails.
 */
export async function extractAmplitudeTrack(audioBuffer: Buffer): Promise<AmplitudeTrack> {
  const samplesPerFrame = Math.floor(SAMPLE_RATE / DEFAULT_FPS);

  const proc = spawn(FFMPEG_BIN, [
    "-loglevel", "error",
    "-i", "pipe:0",
    "-vn",
    "-ac", "1",
    "-ar", String(SAMPLE_RATE),
    "-f", "f32le",
    "pipe:1",
  ]);

  const chunks: Buffer[] = [];
  const stderrLines: string[] = [];
  proc.stdout.on("data", (c: Buffer) => chunks.push(c));
  proc.stderr.on("data", (c: Buffer) => stderrLines.push(c.toString()));

  // Stream the audio buffer in. EPIPE on close is benign (ffmpeg may exit
  // before we finish writing) so swallow it.
  proc.stdin.on("error", () => { /* ignore EPIPE */ });
  proc.stdin.end(audioBuffer);

  await new Promise<void>((resolve, reject) => {
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg amplitude extract exited ${code}: ${stderrLines.join("")}`));
    });
    proc.on("error", reject);
  });

  const pcm = Buffer.concat(chunks);
  // Float32 view over the byte buffer. Copy because Buffer.concat may not be 4-byte aligned.
  const floatBuf = Buffer.alloc(pcm.length);
  pcm.copy(floatBuf);
  const samples = new Float32Array(floatBuf.buffer, floatBuf.byteOffset, Math.floor(floatBuf.byteLength / 4));

  const numFrames = Math.floor(samples.length / samplesPerFrame);
  const out = new Float32Array(numFrames);
  let peak = 0;
  for (let f = 0; f < numFrames; f++) {
    const start = f * samplesPerFrame;
    let sumSq = 0;
    for (let i = 0; i < samplesPerFrame; i++) {
      const s = samples[start + i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / samplesPerFrame);
    out[f] = rms;
    if (rms > peak) peak = rms;
  }

  const result: number[] = new Array(numFrames);
  if (peak > 0) {
    for (let i = 0; i < numFrames; i++) {
      // 4-decimal precision is plenty for a [0,1] visual scale.
      result[i] = Math.round((out[i] / peak) * 10_000) / 10_000;
    }
  } else {
    for (let i = 0; i < numFrames; i++) result[i] = 0;
  }

  return { fps: DEFAULT_FPS, samples: result };
}

/**
 * Derive the canonical amplitude R2 key for a webcam R2 key.
 * `vlad/sessions/.../webcam.webm` → `vlad/sessions/.../webcam.amplitude.json`.
 */
export function amplitudeKeyForWebcam(webcamR2Key: string): string {
  return webcamR2Key.replace(/\.webm$/i, ".amplitude.json");
}

/**
 * Bake (or skip if already present) the amplitude track for a webcam at the
 * given R2 key. Returns the amplitude R2 key.
 *
 * Idempotent — checks for existing JSON before re-running. Safe to call
 * concurrently; last writer wins, but the data is deterministic so it
 * doesn't matter.
 */
export async function bakeAmplitudeForWebcam(webcamR2Key: string): Promise<string> {
  const amplitudeKey = amplitudeKeyForWebcam(webcamR2Key);
  if (amplitudeKey === webcamR2Key) {
    throw new Error(`Cannot derive amplitude key from ${webcamR2Key}`);
  }

  try {
    await downloadBufferFromR2(amplitudeKey);
    return amplitudeKey;
  } catch {
    /* not present — bake */
  }

  const webcamBuffer = await downloadBufferFromR2(webcamR2Key);
  const track = await extractAmplitudeTrack(webcamBuffer);
  await uploadToR2(amplitudeKey, Buffer.from(JSON.stringify(track)), "application/json");
  return amplitudeKey;
}

/** Fetch and parse an amplitude track from R2. Returns null on miss. */
export async function fetchAmplitudeTrack(amplitudeR2Key: string): Promise<AmplitudeTrack | null> {
  try {
    const buf = await downloadBufferFromR2(amplitudeR2Key);
    return JSON.parse(buf.toString("utf-8")) as AmplitudeTrack;
  } catch {
    return null;
  }
}
