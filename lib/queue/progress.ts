/**
 * Unified job progress contract — used by every BullMQ render job (P1 merge,
 * P2 product-only, future custom presets) and persisted to Redis via
 * job.updateProgress(). The UI polls /api/jobs/:jobId which returns these
 * shapes verbatim, so step counts and labels are owned by the job, not the
 * polling layer.
 */

export type JobStep = {
  label: string;
  /** 0..100 */
  progress: number;
};

export type JobProgress =
  | { status: "queued" }
  | { status: "running"; currentStep: number; steps: JobStep[] }
  | { status: "done"; renderId?: string; videoUrl?: string; videoR2Key?: string }
  | { status: "error"; message?: string };
