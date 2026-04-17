import { Worker, Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { REDIS_CONNECTION, QUEUE_NAME } from "@/lib/queue/connection";
import type { JobPayload, ProduceJobPayload, MergeJobPayload } from "@/lib/queue/payloads";
import type { ProduceProgress, MergeJobProgress } from "@/lib/queue/progress";
import { createReplayAction } from "@/lib/render/actions";
import { produceSessionVideo, type ProduceResult } from "@/lib/render/produce";
import { mergeVideoFiles } from "@/lib/render/merge";
import { downloadRecording } from "@/lib/render/download";
import { uploadToR2, downloadFromR2 } from "@/lib/storage/r2";
import { supabase } from "@/lib/db/supabase";
import { updateRenderCache } from "@/lib/cache/render-cache";
import { VIDEO_WIDTH, VIDEO_HEIGHT, RENDER_ZOOM, DEFAULT_FPS } from "@/app/config";

// ---------------------------------------------------------------------------
// Produce job processor
// ---------------------------------------------------------------------------

async function processProduceJob(job: Job<ProduceJobPayload>): Promise<ProduceResult> {
  const d = job.data;

  const replayAction = createReplayAction(d.keyframes, d.durationMs);

  // For warm-start steps >= 2, download cached render from R2 to a temp path
  let existingRenderOutputPath: string | undefined;
  let existingCompositeOutputPath: string | undefined;
  const warmStartDir = path.join(tmpdir(), `vlad-warmstart-${job.id ?? randomUUID().slice(0, 8)}`);

  if (d.startFromStep >= 2 && d.existingRenderR2Key) {
    existingRenderOutputPath = path.join(warmStartDir, "render.mp4");
    await downloadFromR2(d.existingRenderR2Key, existingRenderOutputPath);
  }
  if (d.startFromStep >= 3 && d.existingCompositeR2Key) {
    existingCompositeOutputPath = path.join(warmStartDir, "composite.mp4");
    await downloadFromR2(d.existingCompositeR2Key, existingCompositeOutputPath);
  }

  // Download webcam from R2 if available
  let webcamPath: string | null = null;
  if (d.webcamR2Key) {
    webcamPath = path.join(warmStartDir, "webcam.webm");
    await downloadFromR2(d.webcamR2Key, webcamPath);
  }

  try {
    const result = await produceSessionVideo({
      url: d.url,
      presenter: d.presenter,
      sessionName: d.dirName,
      width: d.width,
      height: d.height,
      videoWidth: d.videoWidth,
      videoHeight: d.videoHeight,
      zoom: d.zoom,
      fps: d.fps,
      durationMs: d.durationMs,
      actions: [replayAction],
      settleHint: d.settleHint,
      webcamSettings: d.webcamSettings,
      webcamPath,
      trimStartSec: d.trimStartSec,
      trimEndSec: d.trimEndSec,
      startFromStep: d.startFromStep,
      existingRenderR2Key: d.existingRenderR2Key,
      existingRenderOutputPath,
      existingRenderDurationMs: d.existingRenderDurationMs,
      existingCompositeR2Key: d.existingCompositeR2Key,
      existingCompositeOutputPath,

      onRenderProgress(rendered, total) {
        job.updateProgress({ status: "rendering", rendered, total } satisfies ProduceProgress);
      },
      onRenderComplete() {
        job.updateProgress({ status: "compositing", composited: 0, total: 0 } satisfies ProduceProgress);
      },
      onComposeProgress(composited, total) {
        job.updateProgress({ status: "compositing", composited, total } satisfies ProduceProgress);
      },
    });

    // Update Redis render cache
    await updateRenderCache(d.presenter, d.safeId, d.urlHash, d.mouseHash, d.wcFingerprint, d.trimKeyStr, {
      renderR2Key: result.renderR2Key,
      renderDurationMs: result.renderDurationMs,
      compositeR2Key: result.compositeR2Key,
      trimmedR2Key: result.trimmedR2Key,
    });

    return result;
  } finally {
    rm(warmStartDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Merge job processor
// ---------------------------------------------------------------------------

type MergeResult = {
  videoUrl: string;
  renderId: string | undefined;
};

async function processMergeJob(job: Job<MergeJobPayload>): Promise<MergeResult> {
  const d = job.data;
  const presenter = d.presenter;
  const jobId = job.id ?? randomUUID().slice(0, 8);

  const stepLabels = [
    "Rendering intro",
    "Compositing intro",
    "Rendering product",
    "Compositing product",
    "Merging",
  ];
  const stepProgress = stepLabels.map(() => 0);

  function updateStep(stepIndex: number, progress: number) {
    stepProgress[stepIndex] = progress;
    job.updateProgress({
      status: "running",
      currentStep: stepIndex,
      stepProgress: [...stepProgress],
      stepLabels,
    } satisfies MergeJobProgress);
  }

  function completeStep(stepIndex: number) {
    updateStep(stepIndex, 100);
  }

  const workDir = path.join(tmpdir(), `vlad-merge-${jobId}`);
  const merchantDir = path.join(workDir, "merchant");
  const productDir = path.join(workDir, "product");
  const mergeOutputDir = path.join(workDir, "output");
  await mkdir(merchantDir, { recursive: true });
  await mkdir(productDir, { recursive: true });
  await mkdir(mergeOutputDir, { recursive: true });

  try {
    // Download both recordings from R2
    const [merchantRec, productRec] = await Promise.all([
      downloadRecording(d.merchant.mouseEventsR2Key, d.merchant.webcamR2Key, merchantDir),
      downloadRecording(d.product.mouseEventsR2Key, d.product.webcamR2Key, productDir),
    ]);

    // --- Merchant video ---
    const merchantAction = createReplayAction(d.merchant.keyframes, d.merchant.durationMs);

    const merchantResult = await produceSessionVideo({
      url: d.merchant.url,
      presenter,
      sessionName: d.merchant.sessionName,
      width: d.merchant.width,
      height: d.merchant.height,
      videoWidth: VIDEO_WIDTH,
      videoHeight: VIDEO_HEIGHT,
      zoom: RENDER_ZOOM,
      fps: DEFAULT_FPS,
      durationMs: d.merchant.durationMs,
      actions: [merchantAction],
      settleHint: d.merchant.settleHint,
      webcamSettings: d.merchant.webcamSettings,
      webcamPath: merchantRec.webcamPath,
      trimStartSec: d.merchant.trimStartSec,
      trimEndSec: d.merchant.trimEndSec,
      onRenderProgress(rendered, total) {
        updateStep(0, Math.round((rendered / total) * 100));
      },
      onRenderComplete() { completeStep(0); },
      onComposeProgress(s, total) {
        updateStep(1, Math.round((s / total) * 100));
      },
    });
    completeStep(1);

    // --- Product video ---
    const productAction = createReplayAction(d.product.keyframes, d.product.durationMs);

    const productResult = await produceSessionVideo({
      url: d.product.url,
      presenter,
      sessionName: d.product.sessionName,
      width: d.product.width,
      height: d.product.height,
      videoWidth: VIDEO_WIDTH,
      videoHeight: VIDEO_HEIGHT,
      zoom: RENDER_ZOOM,
      fps: DEFAULT_FPS,
      durationMs: d.product.durationMs,
      actions: [productAction],
      settleHint: d.product.settleHint,
      webcamSettings: d.product.webcamSettings,
      webcamPath: productRec.webcamPath,
      trimStartSec: d.product.trimStartSec,
      trimEndSec: d.product.trimEndSec,
      onRenderProgress(rendered, total) {
        updateStep(2, Math.round((rendered / total) * 100));
      },
      onRenderComplete() { completeStep(2); },
      onComposeProgress(s, total) {
        updateStep(3, Math.round((s / total) * 100));
      },
    });
    completeStep(3);

    // --- Merge ---
    // Download final videos from R2 (each produce call already uploaded its result)
    const merchantFinalPath = path.join(mergeOutputDir, "merchant-final.mp4");
    const productFinalPath = path.join(mergeOutputDir, "product-final.mp4");
    await Promise.all([
      downloadFromR2(merchantResult.finalR2Key, merchantFinalPath),
      downloadFromR2(productResult.finalR2Key, productFinalPath),
    ]);

    const { mergedPath } = await mergeVideoFiles(
      merchantFinalPath,
      productFinalPath,
      mergeOutputDir,
      d.brand ?? `${d.merchantId}-${d.productName}`,
      (pct) => updateStep(4, pct),
    );
    completeStep(4);

    // Upload merged video to R2
    const r2Key = `merges/${presenter}/${d.outputSessionName}/${path.basename(mergedPath)}`;
    const fileBuffer = await readFile(mergedPath);
    await uploadToR2(r2Key, fileBuffer, "video/mp4");

    // Save to DB
    const { data: renderRow } = await supabase
      .from("vlad_renders")
      .insert({
        merchant_recording_id: d.merchantRecordingId,
        product_recording_id: d.productRecordingId,
        brand: d.brand,
        video_url: r2Key,
        status: "done",
        progress: 100,
        seen: false,
      })
      .select("id")
      .single();

    return { videoUrl: r2Key, renderId: renderRow?.id };
  } finally {
    rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Worker setup
// ---------------------------------------------------------------------------

const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 1);
const lockDuration = Number(process.env.WORKER_LOCK_DURATION_MS ?? 300_000);
const stalledInterval = Number(process.env.WORKER_STALLED_INTERVAL_MS ?? 60_000);

const worker = new Worker<JobPayload>(
  QUEUE_NAME,
  async (job) => {
    if (job.data.type === "produce") {
      return processProduceJob(job as Job<ProduceJobPayload>);
    }
    if (job.data.type === "merge") {
      return processMergeJob(job as Job<MergeJobPayload>);
    }
    throw new Error(`Unknown job type: ${(job.data as Record<string, unknown>).type}`);
  },
  {
    connection: REDIS_CONNECTION,
    concurrency,
    lockDuration,
    stalledInterval,
  },
);

worker.on("completed", (job) => {
  console.log(`[worker] Job ${job.id} (${job.data.type}) completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[worker] Job ${job?.id} (${job?.data.type}) failed:`, err.message);
});

console.log(`[worker] Listening on queue "${QUEUE_NAME}" | concurrency=${concurrency} lockDuration=${lockDuration}ms stalledInterval=${stalledInterval}ms`);

async function shutdown() {
  console.log("[worker] Shutting down...");
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
