import type { Keyframe } from "@/lib/render/keyframes";
import type { WebcamSettings } from "@/types/webcam";

/**
 * Job payload for a single-video produce (render → composite → trim).
 * Enqueued by POST /api/produce.
 */
export type ProduceJobPayload = {
  type: "produce";

  // Identity
  presenter: string;
  safeId: string;
  dirName: string;

  // Target
  url: string;

  // Viewport / render settings
  width: number;
  height: number;
  videoWidth: number;
  videoHeight: number;
  zoom: number;
  fps: number;
  durationMs: number;

  // Replay data (serializable — NOT the RenderAction closure)
  keyframes: Keyframe[];
  settleHint?: { x: number; y: number };

  // Webcam
  webcamSettings: WebcamSettings;
  /** R2 key for webcam video — worker downloads this (null if no webcam) */
  webcamR2Key?: string | null;

  // Trim
  trimStartSec?: number;
  trimEndSec?: number;

  // Warm-start / cache (R2 keys, not filesystem paths)
  startFromStep: 1 | 2 | 3;
  existingRenderR2Key?: string;
  existingRenderDurationMs?: number;
  existingCompositeR2Key?: string;

  // Cache keys (worker updates Redis cache after completion)
  urlHash: string;
  mouseHash: string;
  wcFingerprint: string;
  trimKeyStr: string;

  // Preview quality tier (true → reduced DPR + FFmpeg downscale). Separate cache from full.
  preview: boolean;
};

/** Per-recording data for merge jobs, prepared by the API route. */
export type MergeRecordingPayload = {
  /** Full URL to render (includes query params) */
  url: string;
  /** Session name used for output directory */
  sessionName: string;
  width: number;
  height: number;
  keyframes: Keyframe[];
  settleHint?: { x: number; y: number };
  webcamSettings: WebcamSettings;
  durationMs: number;
  trimStartSec?: number;
  trimEndSec?: number;
  /** R2 key for mouse events JSON — worker downloads this */
  mouseEventsR2Key: string;
  /** R2 key for webcam video — worker downloads this (null if no webcam) */
  webcamR2Key: string | null;
};

/**
 * Job payload for a merge-export (render × 2 → composite × 2 → merge).
 * Enqueued by POST /api/merge-export.
 */
export type MergeJobPayload = {
  type: "merge";

  presenter: string;
  brand: string | null;
  outputSessionName: string;

  // DB record IDs (for the final vlad_renders insert)
  merchantRecordingId: string;
  productRecordingId: string;
  merchantId: string | null;
  productName: string | null;

  merchant: MergeRecordingPayload;
  product: MergeRecordingPayload;
};

export type JobPayload = ProduceJobPayload | MergeJobPayload;
