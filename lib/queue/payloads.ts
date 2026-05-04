import type { Keyframe } from "@/lib/render/keyframes";
import type { RenderSpec, MergeRenderSpec } from "@/lib/render/spec";

/**
 * Job payload for a single-video produce (render+composite → mux → trim).
 * Enqueued by POST /api/produce and POST /api/product-only-export.
 */
export type ProduceJobPayload = {
  type: "produce";

  // Identity
  userId: string;
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

  /** Resolved render config — single source of truth for webcam, throb, morph,
   *  mouse handoff, trim. Built server-side by the route. */
  spec: RenderSpec;

  /** R2 key for webcam video — worker downloads this (null if no webcam) */
  webcamR2Key?: string | null;

  // Warm-start / cache (R2 keys, not filesystem paths)
  startFromStep: 1 | 2 | 3;
  existingRenderR2Key?: string;
  existingRenderDurationMs?: number;
  existingCompositeR2Key?: string;

  // Cache keys (worker updates Redis cache after completion)
  urlHash: string;
  mouseHash: string;
  /** Hash of the resolved RenderSpec sans trim (drives stage 1+2 cache). */
  specHash: string;
  trimKeyStr: string;

  // Preview quality tier (true → reduced DPR + FFmpeg downscale). Separate cache from full.
  preview: boolean;

  /**
   * Optional vlad_recordings.id the worker should backfill with `preview_url` on
   * completion. Set when this job was enqueued for a flow that is (or becomes)
   * a draft. No-op if the row doesn't exist.
   */
  flowId?: string | null;

  /**
   * When set, the worker UPDATEs the pre-stubbed vlad_renders row identified
   * by `renderId` after the produce completes. Used by the product-only
   * export flow, where one product recording fans out into N renders — one
   * per merchant brand.
   */
  mergeRenderInsert?: {
    renderId: string;
  } | null;
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
  /** Resolved render config for this section. */
  spec: RenderSpec;
  durationMs: number;
  /** R2 key for mouse events JSON — worker downloads this */
  mouseEventsR2Key: string;
  /** R2 key for webcam video — worker downloads this (null if no webcam) */
  webcamR2Key: string | null;
};

/**
 * Job payload for a merge-export (render × N → mux × N → merge).
 * Enqueued by POST /api/merge-export.
 *
 * `merchant` and `product` are optional so intro-only and product-only flows
 * can dispatch through the same job type. (Today only product-only fans out
 * via /api/product-only-export → ProduceJobPayload, but the merge processor
 * supports the symmetric case.)
 */
export type MergeJobPayload = {
  type: "merge";

  userId: string;
  /** Pre-stubbed vlad_renders.id — worker UPDATEs this row on completion. */
  renderId: string;
  /** Render display label (also used as the merged-mp4 filename stem). */
  brand: string;
  outputSessionName: string;

  // DB record IDs (for diagnostics / cache lookups). Null when section disabled.
  merchantRecordingId: string | null;
  productRecordingId: string | null;

  merchant: MergeRecordingPayload | null;
  product: MergeRecordingPayload | null;

  /** Cross-section settings (transitions only in v1). */
  merge: MergeRenderSpec;
};

export type JobPayload = ProduceJobPayload | MergeJobPayload;
