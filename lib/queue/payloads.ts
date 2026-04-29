import type { Keyframe } from "@/lib/render/keyframes";
import type { WebcamSettings } from "@/types/webcam";

/**
 * Job payload for a single-video produce (render → composite → trim).
 * Enqueued by POST /api/produce.
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

  /**
   * Optional vlad_recordings.id the worker should backfill with `preview_url` on
   * completion. Set when this job was enqueued for a flow that is (or becomes)
   * a draft. No-op if the row doesn't exist.
   */
  flowId?: string | null;

  /**
   * When set, the worker UPDATEs the pre-stubbed vlad_renders row identified
   * by `renderId` after the produce completes. Used by the merge-export's
   * product-only flow, where one product recording fans out into N renders —
   * one per merchant brand. Distinct from `flowId` (which backfills
   * vlad_recordings).
   *
   * The row is created at job-enqueue time by /api/product-only-export with
   * status='rendering' so the UI can resume polling on reload.
   */
  mergeRenderInsert?: {
    /** Pre-stubbed vlad_renders.id — worker UPDATEs this row on completion. */
    renderId: string;
    productRecordingId: string;
    /** Display label stored on vlad_renders.brand (typically merchant brandName). */
    brand: string | null;
    /** Recording.name of the product, used to build the share slug. */
    productRecordingName: string;
    /** Slugified presenter component (e.g. "jack-otto"), used as a slug prefix. */
    presenterSlug: string;
    /** Cleaned host (e.g. "mammut.com"); used by the share page's "Explore demo" link. */
    brandUrl: string | null;
    /** Product name (e.g. "Trion 28"); appended as ?product=… on the demo link. */
    productName: string | null;
    /** Human-readable brand name (e.g. "And Collar"); used in the share-page title. */
    brandName: string | null;
  } | null;
};

/**
 * Job-level settings for a merge-export. Distinct from per-recording data
 * so that "how the two halves relate" lives in one place.
 *
 * Currently hidden from the UI — defaults applied server-side.
 */
export type MergeJobSettings = {
  /**
   * When true, the intro (merchant) render uses the product recording's
   * webcam settings (mode + corner) instead of its own. Keeps the two
   * halves visually consistent after concat. Default: true.
   */
  introInheritsProductWebcam: boolean;
};

export const DEFAULT_MERGE_JOB_SETTINGS: MergeJobSettings = {
  introInheritsProductWebcam: true,
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

  userId: string;
  /** Pre-stubbed vlad_renders.id — worker UPDATEs this row on completion. */
  renderId: string;
  brand: string | null;
  outputSessionName: string;

  // DB record IDs (for the final vlad_renders insert)
  merchantRecordingId: string;
  productRecordingId: string;
  merchantId: string | null;
  productName: string | null;

  // Display names + presenter, used to build the share slug at insert time.
  merchantRecordingName: string;
  productRecordingName: string;
  presenterSlug: string;

  /** Cleaned host (e.g. "mammut.com"); used by the share page's "Explore demo" link. */
  brandUrl: string | null;
  /** Human-readable brand name (e.g. "And Collar"); used in the share-page title. */
  brandName: string | null;

  merchant: MergeRecordingPayload;
  product: MergeRecordingPayload;

  /** Job-level settings (inheritance, future knobs). Populated server-side with defaults. */
  settings: MergeJobSettings;
};

export type JobPayload = ProduceJobPayload | MergeJobPayload;
