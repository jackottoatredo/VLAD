import { Worker, Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { REDIS_CONNECTION, QUEUE_NAME } from "@/lib/queue/connection";
import type { JobPayload, ProduceJobPayload, MergeJobPayload } from "@/lib/queue/payloads";
import type { JobProgress, JobStep } from "@/lib/queue/progress";
import { createReplayAction } from "@/lib/render/actions";
import { produceSessionVideo, type ProduceResult } from "@/lib/render/produce";
import { mergeVideoFiles } from "@/lib/render/merge";
import { downloadRecording } from "@/lib/render/download";
import { extractPoster } from "@/lib/render/poster";
import { extractSquarePoster } from "@/lib/render/posterSquare";
import { extractPreviewGif } from "@/lib/render/gif";
import { uploadToR2, downloadFromR2 } from "@/lib/storage/r2";
import { supabase } from "@/lib/db/supabase";
import { updateRenderCache } from "@/lib/cache/render-cache";
import { buildBaseSlug, reserveUniqueSlug } from "@/lib/share/slug";
import { logEvent } from "@/lib/stats/events";
import { probeVideoDurationSec } from "@/lib/render/probeDuration";
import { VIDEO_WIDTH, VIDEO_HEIGHT, RENDER_ZOOM, DEFAULT_FPS } from "@/app/config";

// ---------------------------------------------------------------------------
// Share-asset generation: poster + preview GIF, sibling to the final video.
// Uploads both to R2 and returns the R2 keys. Called by both merge and
// produce-only flows once the final video is on disk.
// ---------------------------------------------------------------------------

async function generateAndUploadShareAssets(
  finalVideoPath: string,
  videoR2Key: string,
  workDir: string,
  noWebcamRenderR2Key: string,
): Promise<{ posterKey: string; posterSquareKey: string; gifKey: string }> {
  const dirOnR2 = path.posix.dirname(videoR2Key);
  const posterKey = `${dirOnR2}/poster.jpg`;
  const posterSquareKey = `${dirOnR2}/poster_square.jpg`;
  const gifKey = `${dirOnR2}/preview.gif`;

  const posterLocal = path.join(workDir, "poster.jpg");
  const posterSquareLocal = path.join(workDir, "poster_square.jpg");
  const gifLocal = path.join(workDir, "preview.gif");
  // The no-webcam render is the source for the og:image so the square card
  // shows the screen content, not a portrait of the presenter.
  const noWebcamLocal = path.join(workDir, "render-no-webcam.mp4");

  await downloadFromR2(noWebcamRenderR2Key, noWebcamLocal);

  await extractPoster(finalVideoPath, posterLocal);
  await extractSquarePoster(noWebcamLocal, posterSquareLocal);
  await extractPreviewGif(finalVideoPath, gifLocal);

  const [posterBuf, posterSquareBuf, gifBuf] = await Promise.all([
    readFile(posterLocal),
    readFile(posterSquareLocal),
    readFile(gifLocal),
  ]);

  await Promise.all([
    uploadToR2(posterKey, posterBuf, "image/jpeg"),
    uploadToR2(posterSquareKey, posterSquareBuf, "image/jpeg"),
    uploadToR2(gifKey, gifBuf, "image/gif"),
  ]);

  return { posterKey, posterSquareKey, gifKey };
}

// UPDATE the pre-stubbed vlad_renders row, reserving a unique slug. Retries on
// 23505 (slug race) up to 3 times by re-reserving the next available suffix.
// The row was inserted at job-enqueue time with status='rendering' so the UI
// could resume polling on reload; this flips it to status='done'.
async function updateRenderWithSlug(
  renderId: string,
  baseSlug: string,
  fields: {
    video_url: string;
    poster_key: string;
    poster_square_key: string;
    gif_key: string;
  },
): Promise<{ slug: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = await reserveUniqueSlug(baseSlug);
    const { error } = await supabase
      .from("vlad_renders")
      .update({
        ...fields,
        slug,
        status: "done",
        progress: 100,
      })
      .eq("id", renderId);
    if (!error) return { slug };
    if (error.code !== "23505") {
      throw new Error(`vlad_renders update failed: ${error.message}`);
    }
  }
  throw new Error(`vlad_renders update failed: slug retries exhausted for base "${baseSlug}"`);
}

// ---------------------------------------------------------------------------
// Produce job processor
// ---------------------------------------------------------------------------

type ProduceJobResult = ProduceResult & { renderId?: string };

const PRODUCE_STEP_LABELS = ["Rendering", "Compositing", "Clipping"] as const;

function makeProduceSteps(): JobStep[] {
  return PRODUCE_STEP_LABELS.map((label) => ({ label, progress: 0 }));
}

async function processProduceJob(job: Job<ProduceJobPayload>): Promise<ProduceJobResult> {
  const d = job.data;

  // Emit render_started only when this produce job is tied to a real
  // vlad_renders row (the merge-export product-only path). Preview wizard
  // produces have no render row and shouldn't pollute the dashboard.
  const startedAt = Date.now();
  if (d.mergeRenderInsert) {
    void logEvent({
      type: "render_started",
      userId: d.userId,
      targetId: d.mergeRenderInsert.renderId,
      payload: { kind: "produce" },
    });
  }

  const replayAction = createReplayAction(d.keyframes, d.durationMs);

  const steps = makeProduceSteps();
  function report(currentStep: number) {
    job.updateProgress({ status: "running", currentStep, steps: [...steps] } satisfies JobProgress);
  }

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

  // Reflect warm-start in initial step state — already-done stages are 100%.
  if (d.startFromStep >= 2) steps[0].progress = 100;
  if (d.startFromStep >= 3) steps[1].progress = 100;
  report(d.startFromStep - 1);

  try {
    const result = await produceSessionVideo({
      url: d.url,
      userId: d.userId,
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
      preview: d.preview,
      startFromStep: d.startFromStep,
      existingRenderR2Key: d.existingRenderR2Key,
      existingRenderOutputPath,
      existingRenderDurationMs: d.existingRenderDurationMs,
      existingCompositeR2Key: d.existingCompositeR2Key,
      existingCompositeOutputPath,

      onRenderProgress(rendered, total) {
        steps[0].progress = total > 0 ? Math.round((rendered / total) * 100) : 0;
        report(0);
      },
      onRenderComplete() {
        steps[0].progress = 100;
        report(1);
      },
      onComposeProgress(composited, total) {
        steps[0].progress = 100;
        steps[1].progress = total > 0 ? Math.round((composited / total) * 100) : 0;
        report(1);
      },
    });

    // Composite is fully done by the time produceSessionVideo returns; the
    // remaining work (trim + share-asset upload + DB update) maps to step 2.
    steps[0].progress = 100;
    steps[1].progress = 100;
    steps[2].progress = 50;
    report(2);

    // Update Redis render cache
    await updateRenderCache(d.userId, d.safeId, d.urlHash, d.mouseHash, d.wcFingerprint, d.trimKeyStr, d.preview ? "preview" : "full", {
      renderR2Key: result.renderR2Key,
      renderDurationMs: result.renderDurationMs,
      compositeR2Key: result.compositeR2Key,
      trimmedR2Key: result.trimmedR2Key,
    });

    // If this produce was tied to a draft vlad_recordings row, backfill the
    // preview so reopening the draft later shows it ready. No-op if the row
    // doesn't exist (user never saved).
    if (d.flowId && result.finalR2Key) {
      try {
        await supabase
          .from("vlad_recordings")
          .update({ preview_url: result.finalR2Key, updated_at: new Date().toISOString() })
          .eq("id", d.flowId)
          .eq("status", "draft");
      } catch {
        /* swallow — best-effort */
      }
    }

    // Product-only merge-export path: generate share assets and UPDATE the
    // pre-stubbed vlad_renders row tying this branded render back to its
    // product recording. The row was created at job-enqueue time with
    // status='rendering'; we flip it to 'done' here. A failed UPDATE throws
    // so BullMQ marks the job failed and the UI gets a real error.
    let renderId: string | undefined;
    if (d.mergeRenderInsert && result.finalR2Key && result.finalPath) {
      const { posterKey, posterSquareKey, gifKey } = await generateAndUploadShareAssets(
        result.finalPath,
        result.finalR2Key,
        path.dirname(result.finalPath),
        result.renderR2Key,
      );
      const baseSlug = buildBaseSlug([
        d.mergeRenderInsert.presenterSlug,
        d.mergeRenderInsert.productRecordingName,
      ]);
      await updateRenderWithSlug(d.mergeRenderInsert.renderId, baseSlug, {
        video_url: result.finalR2Key,
        poster_key: posterKey,
        poster_square_key: posterSquareKey,
        gif_key: gifKey,
      });
      renderId = d.mergeRenderInsert.renderId;

      const videoLengthSec = await probeVideoDurationSec(result.finalPath);
      void logEvent({
        type: "render_completed",
        userId: d.userId,
        targetId: renderId,
        payload: {
          kind: "produce",
          renderDurationMs: Date.now() - startedAt,
          videoLengthSec,
        },
      });
    }

    steps[2].progress = 100;
    report(2);

    return { ...result, renderId };
  } finally {
    rm(warmStartDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Merge job processor
// ---------------------------------------------------------------------------

type MergeResult = {
  videoUrl: string;
  renderId: string;
};

const MERGE_STEP_LABELS = [
  "Rendering intro",
  "Compositing intro",
  "Rendering product",
  "Compositing product",
  "Merging",
] as const;

async function processMergeJob(job: Job<MergeJobPayload>): Promise<MergeResult> {
  const d = job.data;
  const userId = d.userId;
  const jobId = job.id ?? randomUUID().slice(0, 8);

  const startedAt = Date.now();
  void logEvent({
    type: "render_started",
    userId,
    targetId: d.renderId,
    payload: { kind: "merge" },
  });

  const steps: JobStep[] = MERGE_STEP_LABELS.map((label) => ({ label, progress: 0 }));

  function updateStep(stepIndex: number, progress: number) {
    steps[stepIndex].progress = progress;
    job.updateProgress({
      status: "running",
      currentStep: stepIndex,
      steps: [...steps],
    } satisfies JobProgress);
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

    // Resolve intro (merchant) webcam settings — optionally inherit from product
    // so both halves of the concatenated video share the same badge corner/mode.
    // The intro still uses its OWN webcam footage (or none).
    const merchantWebcamSettings = d.settings.introInheritsProductWebcam
      ? d.product.webcamSettings
      : d.merchant.webcamSettings;

    // --- Merchant video ---
    const merchantAction = createReplayAction(d.merchant.keyframes, d.merchant.durationMs);

    const merchantResult = await produceSessionVideo({
      url: d.merchant.url,
      userId,
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
      webcamSettings: merchantWebcamSettings,
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
      userId,
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
    const r2Key = `merges/${userId}/${d.outputSessionName}/${path.basename(mergedPath)}`;
    const fileBuffer = await readFile(mergedPath);
    await uploadToR2(r2Key, fileBuffer, "video/mp4");

    // Generate poster + preview gif from the merged file and upload sibling
    // to the mp4. og:image uses the merchant render (no webcam) so the
    // square preview card shows the screen, not the presenter's face.
    const { posterKey, posterSquareKey, gifKey } = await generateAndUploadShareAssets(
      mergedPath,
      r2Key,
      mergeOutputDir,
      merchantResult.renderR2Key,
    );
    const baseSlug = buildBaseSlug([
      d.presenterSlug,
      d.merchantRecordingName,
      d.productRecordingName,
    ]);

    // UPDATE the pre-stubbed row, flipping it from 'rendering' to 'done'. A
    // failed update throws so BullMQ marks the job failed and the UI gets a
    // real error rather than a silent "complete" with no DB update.
    await updateRenderWithSlug(d.renderId, baseSlug, {
      video_url: r2Key,
      poster_key: posterKey,
      poster_square_key: posterSquareKey,
      gif_key: gifKey,
    });

    const videoLengthSec = await probeVideoDurationSec(mergedPath);
    void logEvent({
      type: "render_completed",
      userId,
      targetId: d.renderId,
      payload: {
        kind: "merge",
        renderDurationMs: Date.now() - startedAt,
        videoLengthSec,
      },
    });

    return { videoUrl: r2Key, renderId: d.renderId };
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

worker.on("failed", async (job, err) => {
  console.error(`[worker] Job ${job?.id} (${job?.data.type}) failed:`, err.message);
  // Mark the corresponding vlad_renders row as 'error' so the UI can show
  // Failed + Retry without waiting for the polling layer to notice.
  // Indexed by job_id; a missing row (e.g. /api/produce wizard previews) is
  // a no-op.
  if (job?.id) {
    try {
      await supabase
        .from("vlad_renders")
        .update({ status: "error" })
        .eq("job_id", job.id);
    } catch (updateErr) {
      console.error(`[worker] Failed to mark render row error for job ${job.id}:`, updateErr);
    }
  }
  if (job) {
    const renderId =
      job.data.type === "merge"
        ? job.data.renderId
        : job.data.mergeRenderInsert?.renderId ?? null;
    if (renderId) {
      void logEvent({
        type: "render_failed",
        userId: job.data.userId,
        targetId: renderId,
        payload: { kind: job.data.type, errorMessage: err.message },
      });
    }
  }
});

console.log(`[worker] Listening on queue "${QUEUE_NAME}" | concurrency=${concurrency} lockDuration=${lockDuration}ms stalledInterval=${stalledInterval}ms`);

async function shutdown() {
  console.log("[worker] Shutting down...");
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
