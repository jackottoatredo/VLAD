import { Worker, Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { REDIS_CONNECTION, QUEUE_NAME } from "@/lib/queue/connection";
import type { JobPayload, ProduceJobPayload, MergeJobPayload, MergeRecordingPayload } from "@/lib/queue/payloads";
import type { JobProgress, JobStep } from "@/lib/queue/progress";
import { createReplayAction, createMouseHandoffAction } from "@/lib/render/actions";
import { produceSessionVideo, type ProduceResult } from "@/lib/render/produce";
import { mergeVideoFiles } from "@/lib/render/merge";
import { downloadRecording } from "@/lib/render/download";
import { extractPoster } from "@/lib/render/poster";
import { extractSquarePoster } from "@/lib/render/posterSquare";
import { extractPreviewGif } from "@/lib/render/gif";
import { uploadToR2, downloadFromR2 } from "@/lib/storage/r2";
import { supabase } from "@/lib/db/supabase";
import { updateRenderCache } from "@/lib/cache/render-cache";
import { logEvent } from "@/lib/stats/events";
import { probeVideoDurationSec } from "@/lib/render/probeDuration";
import { fetchAmplitudeTrack, amplitudeKeyForWebcam, bakeAmplitudeForWebcam } from "@/lib/audio/amplitude";
import type { RenderSpec } from "@/lib/render/spec";

// ---------------------------------------------------------------------------
// Share-asset generation: poster + preview GIF, sibling to the final video.
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

async function finalizeRenderRow(
  renderId: string,
  fields: {
    video_url: string;
    poster_key: string;
    poster_square_key: string;
    gif_key: string;
  },
): Promise<void> {
  const { error } = await supabase
    .from("vlad_renders")
    .update({
      ...fields,
      status: "done",
      progress: 100,
    })
    .eq("id", renderId);
  if (error) {
    throw new Error(`vlad_renders update failed: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Amplitude resolution helper
// ---------------------------------------------------------------------------

/**
 * Fetch (or bake-on-miss) the amplitude track for a webcam. Returns null if
 * the spec doesn't enable throb or there's no webcam. Best-effort: a failed
 * bake/fetch downgrades to no-throb rather than failing the render.
 */
async function resolveAmplitudeSamples(
  spec: RenderSpec,
  webcamR2Key: string | null | undefined,
): Promise<number[] | null> {
  if (!spec.throb || !spec.throb.enabled) return null;
  if (!webcamR2Key) return null;

  const key = spec.throb.amplitudeKey ?? amplitudeKeyForWebcam(webcamR2Key);
  let track = await fetchAmplitudeTrack(key);
  if (!track) {
    try {
      await bakeAmplitudeForWebcam(webcamR2Key);
      track = await fetchAmplitudeTrack(key);
    } catch (err) {
      console.warn(`[worker] amplitude bake failed for ${webcamR2Key}:`, err);
      return null;
    }
  }
  return track?.samples ?? null;
}

// ---------------------------------------------------------------------------
// Action assembly: prepend mouse handoff when spec.mouseHandoff is present.
// ---------------------------------------------------------------------------

function buildActions(
  spec: RenderSpec,
  keyframes: ProduceJobPayload["keyframes"],
  durationMs: number,
): ReturnType<typeof createReplayAction>[] {
  const replay = createReplayAction(keyframes, durationMs);
  if (!spec.mouseHandoff || keyframes.length === 0) return [replay];

  const handoff = createMouseHandoffAction(
    { x: spec.mouseHandoff.fromX, y: spec.mouseHandoff.fromY },
    { x: keyframes[0].x, y: keyframes[0].y },
    spec.mouseHandoff.durationMs,
  );
  return [handoff, replay];
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

  const startedAt = Date.now();
  if (d.mergeRenderInsert) {
    void logEvent({
      type: "render_started",
      userId: d.userId,
      targetId: d.mergeRenderInsert.renderId,
      payload: { kind: "produce" },
    });
  }

  const actions = buildActions(d.spec, d.keyframes, d.durationMs);

  const steps = makeProduceSteps();
  function report(currentStep: number) {
    job.updateProgress({ status: "running", currentStep, steps: [...steps] } satisfies JobProgress);
  }

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

  let webcamPath: string | null = null;
  if (d.webcamR2Key) {
    webcamPath = path.join(warmStartDir, "webcam.webm");
    await downloadFromR2(d.webcamR2Key, webcamPath);
  }

  const amplitudeSamples = await resolveAmplitudeSamples(d.spec, d.webcamR2Key);

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
      actions,
      settleHint: d.settleHint,
      spec: d.spec,
      webcamPath,
      amplitudeSamples,
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

    steps[0].progress = 100;
    steps[1].progress = 100;
    steps[2].progress = 50;
    report(2);

    await updateRenderCache(
      d.userId,
      d.safeId,
      d.urlHash,
      d.mouseHash,
      d.specHash,
      d.trimKeyStr,
      d.preview ? "preview" : "full",
      {
        renderR2Key: result.renderR2Key,
        renderDurationMs: result.renderDurationMs,
        compositeR2Key: result.compositeR2Key,
        trimmedR2Key: result.trimmedR2Key,
      },
    );

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

    let renderId: string | undefined;
    if (d.mergeRenderInsert && result.finalR2Key && result.finalPath) {
      const { posterKey, posterSquareKey, gifKey } = await generateAndUploadShareAssets(
        result.finalPath,
        result.finalR2Key,
        path.dirname(result.finalPath),
        result.renderR2Key,
      );
      await finalizeRenderRow(d.mergeRenderInsert.renderId, {
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

const PRODUCT_ONLY_STEP_LABELS = [
  "Rendering",
  "Compositing",
  "Clipping",
] as const;

const INTRO_ONLY_STEP_LABELS = [
  "Rendering",
  "Compositing",
  "Clipping",
] as const;

/**
 * Render one section of a merge through the full produce pipeline. Returns
 * the produce result + the local final path for downstream merging.
 */
async function renderMergeSection(
  userId: string,
  recording: MergeRecordingPayload,
  webcamPath: string | null,
  onRenderProgress: (pct: number) => void,
  onRenderDone: () => void,
  onComposeProgress: (pct: number) => void,
): Promise<ProduceResult> {
  const amplitudeSamples = await resolveAmplitudeSamples(recording.spec, recording.webcamR2Key);
  const actions = buildActions(recording.spec, recording.keyframes, recording.durationMs);

  return produceSessionVideo({
    url: recording.url,
    userId,
    sessionName: recording.sessionName,
    width: recording.width,
    height: recording.height,
    videoWidth: recording.width,
    videoHeight: recording.height,
    fps: 30,
    durationMs: recording.durationMs,
    actions,
    settleHint: recording.settleHint,
    spec: recording.spec,
    webcamPath,
    amplitudeSamples,
    onRenderProgress(rendered, total) {
      onRenderProgress(total > 0 ? Math.round((rendered / total) * 100) : 0);
    },
    onRenderComplete() { onRenderDone(); },
    onComposeProgress(s, total) {
      onComposeProgress(total > 0 ? Math.round((s / total) * 100) : 0);
    },
  });
}

async function processMergeJob(job: Job<MergeJobPayload>): Promise<MergeResult> {
  const d = job.data;
  const userId = d.userId;
  const jobId = job.id ?? randomUUID().slice(0, 8);
  const hasIntro = !!d.merchant;
  const hasProduct = !!d.product;
  const dualSection = hasIntro && hasProduct;

  if (!hasIntro && !hasProduct) {
    throw new Error("Merge job has neither intro nor product section.");
  }

  const startedAt = Date.now();
  void logEvent({
    type: "render_started",
    userId,
    targetId: d.renderId,
    payload: { kind: "merge" },
  });

  const stepLabels = dualSection
    ? MERGE_STEP_LABELS
    : hasIntro
      ? INTRO_ONLY_STEP_LABELS
      : PRODUCT_ONLY_STEP_LABELS;

  const steps: JobStep[] = stepLabels.map((label) => ({ label, progress: 0 }));

  function updateStep(stepIndex: number, progress: number) {
    steps[stepIndex].progress = progress;
    job.updateProgress({
      status: "running",
      currentStep: stepIndex,
      steps: [...steps],
    } satisfies JobProgress);
  }
  function completeStep(stepIndex: number) { updateStep(stepIndex, 100); }

  const workDir = path.join(tmpdir(), `vlad-merge-${jobId}`);
  const merchantDir = path.join(workDir, "merchant");
  const productDir = path.join(workDir, "product");
  const mergeOutputDir = path.join(workDir, "output");
  await mkdir(merchantDir, { recursive: true });
  await mkdir(productDir, { recursive: true });
  await mkdir(mergeOutputDir, { recursive: true });

  try {
    let merchantResult: ProduceResult | null = null;
    let productResult: ProduceResult | null = null;

    if (hasIntro) {
      const merchantRec = await downloadRecording(
        d.merchant!.mouseEventsR2Key,
        d.merchant!.webcamR2Key,
        merchantDir,
      );
      merchantResult = await renderMergeSection(
        userId,
        d.merchant!,
        merchantRec.webcamPath,
        (pct) => updateStep(0, pct),
        () => completeStep(0),
        (pct) => updateStep(dualSection ? 1 : 1, pct),
      );
      if (dualSection) completeStep(1);
    }

    if (hasProduct) {
      const productRec = await downloadRecording(
        d.product!.mouseEventsR2Key,
        d.product!.webcamR2Key,
        productDir,
      );
      const renderStepIdx = dualSection ? 2 : 0;
      const composeStepIdx = dualSection ? 3 : 1;
      productResult = await renderMergeSection(
        userId,
        d.product!,
        productRec.webcamPath,
        (pct) => updateStep(renderStepIdx, pct),
        () => completeStep(renderStepIdx),
        (pct) => updateStep(composeStepIdx, pct),
      );
      completeStep(composeStepIdx);
    }

    let finalLocalPath: string;
    let finalR2Key: string;
    let finalDirOnR2: string;
    let posterSourceR2Key: string;

    if (dualSection) {
      // Both sections: concat trimmed outputs, generate share assets.
      const merchantFinalPath = path.join(mergeOutputDir, "merchant-final.mp4");
      const productFinalPath = path.join(mergeOutputDir, "product-final.mp4");
      await Promise.all([
        downloadFromR2(merchantResult!.finalR2Key, merchantFinalPath),
        downloadFromR2(productResult!.finalR2Key, productFinalPath),
      ]);

      const { mergedPath } = await mergeVideoFiles(
        merchantFinalPath,
        productFinalPath,
        mergeOutputDir,
        d.brand,
        (pct) => updateStep(4, pct),
      );
      completeStep(4);

      finalR2Key = `merges/${userId}/${d.outputSessionName}/${path.basename(mergedPath)}`;
      const fileBuffer = await readFile(mergedPath);
      await uploadToR2(finalR2Key, fileBuffer, "video/mp4");
      finalLocalPath = mergedPath;
      finalDirOnR2 = path.posix.dirname(finalR2Key);
      posterSourceR2Key = merchantResult!.renderR2Key;
    } else {
      // Single-section merge: just publish the produce output as the final.
      const sole = (merchantResult ?? productResult)!;
      finalR2Key = sole.finalR2Key;
      finalLocalPath = sole.finalPath;
      finalDirOnR2 = path.posix.dirname(finalR2Key);
      posterSourceR2Key = sole.renderR2Key;
    }
    void finalDirOnR2;

    const { posterKey, posterSquareKey, gifKey } = await generateAndUploadShareAssets(
      finalLocalPath,
      finalR2Key,
      mergeOutputDir,
      posterSourceR2Key,
    );

    await finalizeRenderRow(d.renderId, {
      video_url: finalR2Key,
      poster_key: posterKey,
      poster_square_key: posterSquareKey,
      gif_key: gifKey,
    });

    const videoLengthSec = await probeVideoDurationSec(finalLocalPath);
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

    return { videoUrl: finalR2Key, renderId: d.renderId };
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
