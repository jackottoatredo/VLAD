import { Worker, Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { REDIS_CONNECTION, QUEUE_NAME, jobsQueue } from "@/lib/queue/connection";
import type {
  JobPayload,
  ProduceJobPayload,
  MergeJobPayload,
  MergeRecordingPayload,
} from "@/lib/queue/payloads";
import {
  processDailyDigestTick,
  processWeeklyDigestTick,
} from "@/lib/notifications/processDigest";
import type { JobProgress, JobStep } from "@/lib/queue/progress";
import { createReplayAction } from "@/lib/render/actions";
import { produceSessionVideo, type ProduceResult } from "@/lib/render/produce";
import { renderBackgroundToMp4 } from "@/lib/render/render-background";
import { renderUnifiedMergeOverlay } from "@/lib/render/render-overlay-unified";
import { composeLayeredMerge, extractAudioChunk } from "@/lib/render/merge";
import { computeCursorPositions } from "@/lib/render/cursor-track";
import { readFileSync } from "node:fs";
import { downloadRecording } from "@/lib/render/download";
import { extractPoster } from "@/lib/render/poster";
import { extractSquarePoster } from "@/lib/render/posterSquare";
import { extractPreviewGif } from "@/lib/render/gif";
import {
  uploadToR2,
  downloadFromR2,
  copyR2Object,
  recordingDir,
  recordingJobDir,
  renderDir,
  renderJobDir,
  sectionDir,
} from "@/lib/storage/r2";
import { supabase } from "@/lib/db/supabase";
import { updateRenderCache } from "@/lib/cache/render-cache";
import { logEvent } from "@/lib/stats/events";
import { probeVideoDurationSec } from "@/lib/render/probeDuration";
import { fetchAmplitudeTrack, amplitudeKeyForWebcam, bakeAmplitudeForWebcam } from "@/lib/audio/amplitude";
import { fetchWebcamFrames, bakeWebcamFramesForUpload } from "@/lib/audio/webcam-frames";
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
  // Hook 3 — re-render predecessor cleanup. Final-output paths are now
  // static under renderDir/{video.mp4,poster.jpg,...} so a re-render
  // overwrites them in place; the only thing leaking would be the previous
  // attempt's intermediates/{prevJobId}/ tree. Capture the previous job_id
  // before update so we can wipe its intermediate dir if the new write
  // changes job_id.
  const { data: prev } = await supabase
    .from("vlad_renders")
    .select("user_id, job_id")
    .eq("id", renderId)
    .maybeSingle();

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

  // If a different job_id ran a previous attempt for this same render row,
  // its intermediates/{prevJobId}/ tree is now orphan. Wipe it. (Same job_id
  // means it's the run we just finished — leave it for cache reuse.)
  if (prev?.user_id && prev.job_id) {
    // We can't directly know the new job_id from here without plumbing it
    // through, so we conservatively check: did we just write a different
    // job_id from what was previously stored? finalizeRenderRow doesn't
    // touch job_id (the route sets it on insert), so prev.job_id == current
    // job_id → no cleanup needed. This branch is a no-op today; left here
    // so a future code path that re-assigns job_id has a clean cleanup hook.
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

/**
 * Fetch (or bake-on-miss) the pre-extracted webcam frame bundle for a given
 * webcam R2 key. Returns the per-frame JPEG buffers in capture order, or
 * null when no webcam is associated with the section.
 *
 * Best-effort: a failed bake/fetch downgrades to no-frames (overlay shows
 * empty webcam wrap) rather than failing the render.
 */
async function resolveWebcamFrames(
  webcamR2Key: string | null | undefined,
): Promise<Buffer[] | null> {
  if (!webcamR2Key) return null;
  let bundle = await fetchWebcamFrames(webcamR2Key);
  if (!bundle) {
    try {
      await bakeWebcamFramesForUpload(webcamR2Key);
      bundle = await fetchWebcamFrames(webcamR2Key);
    } catch (err) {
      console.warn(`[worker] webcam frame bake failed for ${webcamR2Key}:`, err);
      return null;
    }
  }
  return bundle?.frames ?? null;
}

// ---------------------------------------------------------------------------
// Action assembly: a single replay action that drives `page.mouse.move` for
// hover state and screenshots each frame. The cursor sprite — and any
// boundary glide — is composited later in the FFmpeg compose stage from a
// per-frame position track derived from spec.mouseTrack.
// ---------------------------------------------------------------------------

function buildActions(
  _spec: RenderSpec,
  keyframes: ProduceJobPayload["keyframes"],
  durationMs: number,
): ReturnType<typeof createReplayAction>[] {
  return [createReplayAction(keyframes, durationMs)];
}

// ---------------------------------------------------------------------------
// Produce job processor
// ---------------------------------------------------------------------------

type ProduceJobResult = ProduceResult & { renderId?: string };

const PRODUCE_STEP_LABELS = ["Rendering", "Compositing", "Clipping"] as const;

function makeProduceSteps(): JobStep[] {
  return PRODUCE_STEP_LABELS.map((label, idx) =>
    idx === 0
      ? {
          label,
          progress: 0,
          // Render step has two parallel lanes (background browser pass +
          // overlay browser pass). Cursor is computed in-process and is
          // effectively instant — not worth its own bar.
          subTasks: [
            { label: "Background", progress: 0 },
            { label: "Overlay", progress: 0 },
          ],
        }
      : { label, progress: 0 },
  );
}

async function processProduceJob(job: Job<ProduceJobPayload>): Promise<ProduceJobResult> {
  const d = job.data;

  // Mirror to console (Railway logs) AND BullMQ per-job log (admin UI lookup
  // on failure). Fire-and-forget on the BullMQ side — Redis hop shouldn't
  // gate the hot path; the failed-handler awaits its own final log entry.
  const logStep = (msg: string) => {
    console.log(`[produce ${job.id}] ${msg}`);
    void job.log(`${new Date().toISOString()} ${msg}`);
  };

  const startedAt = Date.now();
  logStep(
    `start: section=${d.section} flowId=${d.flowId ?? "-"} ` +
      `mergeRenderId=${d.mergeRenderInsert?.renderId ?? "-"} ` +
      `startFromStep=${d.startFromStep} preview=${d.preview} ` +
      `userId=${d.userId}`,
  );
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

  const workDir = path.join(tmpdir(), `vlad-produce-${job.id ?? randomUUID().slice(0, 8)}`);

  // Warm-start: download cached render/composite from R2 to local temp.
  let existingCompositeOutputPath: string | undefined;
  let existingBackgroundPath: string | undefined;
  let existingOverlayPath: string | undefined;
  if (d.startFromStep >= 2 && d.existingBackgroundR2Key && d.existingOverlayR2Key) {
    existingBackgroundPath = path.join(workDir, "background.mp4");
    existingOverlayPath = path.join(workDir, "overlay.webm");
    await Promise.all([
      downloadFromR2(d.existingBackgroundR2Key, existingBackgroundPath),
      downloadFromR2(d.existingOverlayR2Key, existingOverlayPath),
    ]);
  }
  if (d.startFromStep >= 3 && d.existingCompositeR2Key) {
    existingCompositeOutputPath = path.join(workDir, "composite.mp4");
    await downloadFromR2(d.existingCompositeR2Key, existingCompositeOutputPath);
  }

  let webcamPath: string | null = null;
  if (d.webcamR2Key) {
    webcamPath = path.join(workDir, "webcam.webm");
    await downloadFromR2(d.webcamR2Key, webcamPath);
  }

  // Resolve pre-baked assets (amplitude track + per-frame JPEG bundle) in
  // parallel — both come from R2 and neither blocks the other.
  const [amplitudeSamples, webcamFrames] = await Promise.all([
    resolveAmplitudeSamples(d.spec, d.webcamR2Key),
    resolveWebcamFrames(d.webcamR2Key),
  ]);

  // Reflect warm-start in initial step state — already-done stages are 100%.
  if (d.startFromStep >= 2) steps[0].progress = 100;
  if (d.startFromStep >= 3) steps[1].progress = 100;
  report(d.startFromStep - 1);

  // Compute the per-job intermediate dir based on which entity owns the
  // produce. Product-only-export attaches a render row (mergeRenderInsert) →
  // intermediates nest under that render. Plain preview produce has no
  // render row → intermediates nest under the recording (safeId === flowId).
  const jobId = job.id ?? randomUUID().slice(0, 8);
  const produceIntermediatesDir = d.mergeRenderInsert
    ? renderJobDir(d.userId, d.mergeRenderInsert.renderId, jobId)
    : recordingJobDir(d.userId, d.safeId, jobId);

  if (d.startFromStep > 1) {
    logStep(
      `warm-start step=${d.startFromStep} ` +
        `bg=${d.existingBackgroundR2Key ?? "-"} ov=${d.existingOverlayR2Key ?? "-"} ` +
        `composite=${d.existingCompositeR2Key ?? "-"}`,
    );
  }

  try {
    logStep(`render: produceSessionVideo intermediates=${produceIntermediatesDir}`);
    const result = await produceSessionVideo({
      url: d.url,
      intermediatesDir: produceIntermediatesDir,
      section: d.section,
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
      keyframes: d.keyframes,
      webcamPath,
      webcamFrames,
      amplitudeSamples,
      preview: d.preview,
      startFromStep: d.startFromStep,
      existingBackgroundR2Key: d.existingBackgroundR2Key,
      existingBackgroundPath,
      existingOverlayR2Key: d.existingOverlayR2Key,
      existingOverlayPath,
      existingRenderDurationMs: d.existingRenderDurationMs,
      existingCompositeR2Key: d.existingCompositeR2Key,
      existingCompositeOutputPath,

      onRenderProgress(rendered, total) {
        steps[0].progress = total > 0 ? Math.round((rendered / total) * 100) : 0;
        report(0);
      },
      onBackgroundProgress(rendered, total) {
        if (steps[0].subTasks) {
          steps[0].subTasks[0].progress = total > 0 ? Math.round((rendered / total) * 100) : 0;
          report(0);
        }
      },
      onOverlayProgress(rendered, total) {
        if (steps[0].subTasks) {
          steps[0].subTasks[1].progress = total > 0 ? Math.round((rendered / total) * 100) : 0;
          report(0);
        }
      },
      onRenderComplete() {
        steps[0].progress = 100;
        if (steps[0].subTasks) {
          steps[0].subTasks[0].progress = 100;
          steps[0].subTasks[1].progress = 100;
        }
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
        backgroundR2Key: result.backgroundR2Key,
        overlayR2Key: result.overlayR2Key,
        renderDurationMs: result.renderDurationMs,
        compositeR2Key: result.compositeR2Key,
        trimmedR2Key: result.trimmedR2Key,
      },
    );

    // Promote the produce intermediate (trim or composite) to the entity's
    // canonical video path. Static paths mean re-produces overwrite in place
    // — no orphan from previous attempts; the `intermediates/{jobId}/`
    // tree(s) accumulate but get swept by the entity-prefix delete on
    // recording / render delete.
    logStep(
      `produce done: finalR2Key=${result.finalR2Key} ` +
        `bg=${result.backgroundR2Key} ov=${result.overlayR2Key}`,
    );

    if (d.flowId && result.finalR2Key) {
      try {
        const previewKey = `${recordingDir(d.userId, d.flowId)}/preview.mp4`;
        logStep(`promote preview: ${result.finalR2Key} → ${previewKey}`);
        await copyR2Object(result.finalR2Key, previewKey);
        await supabase
          .from("vlad_recordings")
          .update({ preview_url: previewKey, updated_at: new Date().toISOString() })
          .eq("id", d.flowId)
          .eq("status", "draft");
      } catch {
        /* swallow — best-effort */
      }
    }

    let renderId: string | undefined;
    if (d.mergeRenderInsert && result.finalR2Key && result.finalPath) {
      // Promote produce final to renderDir/video.mp4 first so share assets
      // (poster/gif) land at renderDir/* via path.posix.dirname() inside
      // generateAndUploadShareAssets — siblings to the canonical video.
      const renderEntityDir = renderDir(d.userId, d.mergeRenderInsert.renderId);
      const videoKey = `${renderEntityDir}/video.mp4`;
      logStep(`promote render video: ${result.finalR2Key} → ${videoKey}`);
      await copyR2Object(result.finalR2Key, videoKey);

      logStep("share assets: poster + poster_square + gif");
      const { posterKey, posterSquareKey, gifKey } = await generateAndUploadShareAssets(
        result.finalPath,
        videoKey,
        path.dirname(result.finalPath),
        result.backgroundR2Key,
      );
      logStep(`finalize render row: renderId=${d.mergeRenderInsert.renderId}`);
      await finalizeRenderRow(d.mergeRenderInsert.renderId, {
        video_url: videoKey,
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
    rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Merge job processor
// ---------------------------------------------------------------------------

type MergeResult = {
  videoUrl: string;
  renderId: string;
};

// v4 dual-section merge skips per-section compose+trim — the merge stage
// composites everything (layers + cursor + audio) in one FFmpeg pass.
const MERGE_STEP_LABELS = [
  "Rendering intro",
  "Rendering product",
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
  intermediatesDir: string,
  section: "merchant" | "product",
  recording: MergeRecordingPayload,
  webcamPath: string | null,
  onRenderProgress: (pct: number) => void,
  onRenderDone: () => void,
  onComposeProgress: (pct: number) => void,
  onBackgroundProgress?: (pct: number) => void,
  onOverlayProgress?: (pct: number) => void,
): Promise<ProduceResult> {
  const [amplitudeSamples, webcamFrames] = await Promise.all([
    resolveAmplitudeSamples(recording.spec, recording.webcamR2Key),
    resolveWebcamFrames(recording.webcamR2Key),
  ]);
  const actions = buildActions(recording.spec, recording.keyframes, recording.durationMs);

  return produceSessionVideo({
    url: recording.url,
    intermediatesDir,
    section,
    width: recording.width,
    height: recording.height,
    videoWidth: recording.width,
    videoHeight: recording.height,
    fps: 30,
    durationMs: recording.durationMs,
    actions,
    settleHint: recording.settleHint,
    spec: recording.spec,
    keyframes: recording.keyframes,
    webcamPath,
    webcamFrames,
    amplitudeSamples,
    onRenderProgress(rendered, total) {
      onRenderProgress(total > 0 ? Math.round((rendered / total) * 100) : 0);
    },
    onBackgroundProgress(rendered, total) {
      onBackgroundProgress?.(total > 0 ? Math.round((rendered / total) * 100) : 0);
    },
    onOverlayProgress(rendered, total) {
      onOverlayProgress?.(total > 0 ? Math.round((rendered / total) * 100) : 0);
    },
    onRenderComplete() { onRenderDone(); },
    onComposeProgress(s, total) {
      onComposeProgress(total > 0 ? Math.round((s / total) * 100) : 0);
    },
  });
}

// ---------------------------------------------------------------------------
// Dual-section merge: render LAYERS only (no compose, no trim per section).
// The merge stage composites everything (bg xfade + overlay concat + cursor +
// audio) in a single FFmpeg pass — that's what unlocks the clean visual
// crossfade (background blends, overlay never dissolves into the audio icon).
// ---------------------------------------------------------------------------

/**
 * v6: render the BACKGROUND ONLY for one section. The overlay is rendered
 * by a separate unified pass that spans both sections (renderUnifiedMergeOverlay
 * in lib/render/render-overlay-unified.ts), so dual-section merge no longer
 * needs a per-section overlay browser pass.
 *
 * Returns paths, R2 keys, and the resolved amplitude + webcam-frame buffers
 * (the unified overlay needs both for its single pass).
 */
async function renderMergeSectionBackground(
  sectionIntermediatesDir: string,
  recording: MergeRecordingPayload,
  onProgress: (pct: number) => void,
): Promise<{
  backgroundPath: string;
  backgroundR2Key: string;
  fullDurationMs: number;
  amplitudeSamples: number[] | null;
  webcamFrames: Buffer[] | null;
}> {
  const [amplitudeSamples, webcamFrames] = await Promise.all([
    resolveAmplitudeSamples(recording.spec, recording.webcamR2Key),
    resolveWebcamFrames(recording.webcamR2Key),
  ]);
  const actions = buildActions(recording.spec, recording.keyframes, recording.durationMs);

  const bg = await renderBackgroundToMp4({
    url: recording.url,
    intermediatesDir: sectionIntermediatesDir,
    width: recording.width,
    height: recording.height,
    videoWidth: recording.width,
    videoHeight: recording.height,
    fps: 30,
    durationMs: recording.durationMs,
    actions,
    settleHint: recording.settleHint,
    onProgress(rendered, total) {
      onProgress(total > 0 ? Math.round((rendered / total) * 100) : 0);
    },
  });

  return {
    backgroundPath: bg.outputPath,
    backgroundR2Key: bg.videoUrl,
    fullDurationMs: bg.totalDurationMs,
    amplitudeSamples,
    webcamFrames,
  };
}

const MERGE_CURSOR_SVG_PATH = path.join(process.cwd(), "public", "cursor.svg");
const MERGE_CURSOR_SIZE_PX = 32;
let mergeCursorCache: Buffer | null = null;
function loadMergeCursorSource(): Buffer {
  if (mergeCursorCache) return mergeCursorCache;
  mergeCursorCache = readFileSync(MERGE_CURSOR_SVG_PATH);
  return mergeCursorCache;
}

/**
 * Build the unified per-frame cursor track for the merged output. Each
 * section's positions are computed against its full session, then sliced
 * to its trim window, then concatenated. Length === merged output frames.
 */
function buildMergedCursorPositions(
  intro: MergeRecordingPayload,
  introDurationMs: number,
  product: MergeRecordingPayload,
  productDurationMs: number,
  fps: number,
): { x: number; y: number }[] {
  const introTotalFrames = Math.max(1, Math.round((introDurationMs / 1000) * fps));
  const productTotalFrames = Math.max(1, Math.round((productDurationMs / 1000) * fps));

  const introAll = computeCursorPositions({
    keyframes: intro.keyframes,
    fps,
    width: intro.width,
    height: intro.height,
    totalFrames: introTotalFrames,
    trimStartMs: intro.spec.trim?.startSec != null ? intro.spec.trim.startSec * 1000 : undefined,
    trimEndMs: intro.spec.trim?.endSec != null ? intro.spec.trim.endSec * 1000 : undefined,
    mouseTrack: intro.spec.mouseTrack,
  });
  const productAll = computeCursorPositions({
    keyframes: product.keyframes,
    fps,
    width: product.width,
    height: product.height,
    totalFrames: productTotalFrames,
    trimStartMs: product.spec.trim?.startSec != null ? product.spec.trim.startSec * 1000 : undefined,
    trimEndMs: product.spec.trim?.endSec != null ? product.spec.trim.endSec * 1000 : undefined,
    mouseTrack: product.spec.mouseTrack,
  });

  const introTrimStartFrame = intro.spec.trim?.startSec
    ? Math.round(intro.spec.trim.startSec * fps)
    : 0;
  const introTrimEndFrame = intro.spec.trim?.endSec
    ? Math.min(introTotalFrames, Math.round(intro.spec.trim.endSec * fps))
    : introTotalFrames;
  const productTrimStartFrame = product.spec.trim?.startSec
    ? Math.round(product.spec.trim.startSec * fps)
    : 0;
  const productTrimEndFrame = product.spec.trim?.endSec
    ? Math.min(productTotalFrames, Math.round(product.spec.trim.endSec * fps))
    : productTotalFrames;

  return [
    ...introAll.slice(introTrimStartFrame, introTrimEndFrame),
    ...productAll.slice(productTrimStartFrame, productTrimEndFrame),
  ];
}

async function processMergeJob(job: Job<MergeJobPayload>): Promise<MergeResult> {
  const d = job.data;
  const userId = d.userId;
  const jobId = job.id ?? randomUUID().slice(0, 8);
  const hasIntro = !!d.merchant;
  const hasProduct = !!d.product;
  const dualSection = hasIntro && hasProduct;

  // See processProduceJob for rationale — same pattern.
  const logStep = (msg: string) => {
    console.log(`[merge ${jobId}] ${msg}`);
    void job.log(`${new Date().toISOString()} ${msg}`);
  };
  logStep(
    `start: renderId=${d.renderId} userId=${userId} ` +
      `hasIntro=${hasIntro} hasProduct=${hasProduct} dualSection=${dualSection}`,
  );

  // Per-merge intermediate root. Per-section bg/ov files nest under
  // {intermediatesDir}/{merchant,product}/, the unified overlay (uov.mov)
  // and any composite/trim outputs sit at the root. The render's final
  // video is at renderDir/video.mp4 — outside intermediates/.
  const mergeIntermediatesDir = renderJobDir(userId, d.renderId, jobId);
  const renderEntityDir = renderDir(userId, d.renderId);

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

  const steps: JobStep[] = stepLabels.map((label, idx) => {
    // For dual-section merge ("Rendering intro" / "Rendering product" / "Merging"),
    // give the two render steps Background+Overlay sub-task lanes. For
    // single-section merge ("Rendering" / "Compositing" / "Clipping"), the
    // "Rendering" step (idx 0) gets the same lanes — same as produce-job
    // step 0.
    const isRenderStep = dualSection ? idx < 2 : idx === 0;
    if (isRenderStep) {
      return {
        label,
        progress: 0,
        subTasks: [
          { label: "Background", progress: 0 },
          { label: "Overlay", progress: 0 },
        ],
      };
    }
    return { label, progress: 0 };
  });

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
    let finalLocalPath: string;
    let finalR2Key: string;
    let posterSourceR2Key: string;

    if (dualSection) {
      // ---- Dual-section: v6 layered render with UNIFIED overlay ----
      // Per section: only render the background (no per-section overlay).
      // A single unified overlay pass spans the merged output duration and
      // is rendered in parallel with the two background passes. The merge
      // stage composites everything (bg + cursor + unified overlay + audio)
      // in one FFmpeg call. The overlay morph is a single continuous
      // animation across the boundary — no per-section seam to coordinate.

      const [merchantRec, productRec] = await Promise.all([
        downloadRecording(d.merchant!.mouseEventsR2Key, d.merchant!.webcamR2Key, merchantDir),
        downloadRecording(d.product!.mouseEventsR2Key, d.product!.webcamR2Key, productDir),
      ]);
      const merchantWebcamLocalPath = merchantRec.webcamPath;
      const productWebcamLocalPath = productRec.webcamPath;

      // Both background passes resolve their own webcam frames + amplitude
      // tracks (needed by the unified overlay). Run them sequentially first
      // so we have those buffers, THEN kick off the unified overlay pass
      // alongside whichever bg is still going. Simpler: render both bg's
      // sequentially, then unified overlay. Total: 3 sequential renders.
      // The bg passes are typically the slowest; if needed, we can later
      // run intro_bg + (product_bg → unified_ov) in parallel.

      logStep("dual: rendering intro background");
      const introBg = await renderMergeSectionBackground(
        sectionDir(mergeIntermediatesDir, "merchant"),
        d.merchant!,
        (pct) => updateStep(0, pct),
      );
      completeStep(0);
      logStep(`intro bg done: ${introBg.backgroundR2Key} dur=${introBg.fullDurationMs}ms`);

      logStep("dual: rendering product background");
      const productBg = await renderMergeSectionBackground(
        sectionDir(mergeIntermediatesDir, "product"),
        d.product!,
        (pct) => updateStep(1, pct),
      );
      completeStep(1);
      logStep(`product bg done: ${productBg.backgroundR2Key} dur=${productBg.fullDurationMs}ms`);

      // Compute output frame count and boundary index from the trim windows.
      const introTrimStartSec = d.merchant!.spec.trim?.startSec ?? 0;
      const introTrimEndSec = d.merchant!.spec.trim?.endSec ?? 0;
      const productTrimStartSec = d.product!.spec.trim?.startSec ?? 0;
      const productTrimEndSec = d.product!.spec.trim?.endSec ?? 0;
      const introTrimmedSec =
        (introTrimEndSec > 0 ? introTrimEndSec : introBg.fullDurationMs / 1000) - introTrimStartSec;
      const productTrimmedSec =
        (productTrimEndSec > 0 ? productTrimEndSec : productBg.fullDurationMs / 1000) - productTrimStartSec;
      const fps = 30;
      const boundaryFrameIdx = Math.round(introTrimmedSec * fps);
      const totalOutputFrames = Math.max(1, Math.round((introTrimmedSec + productTrimmedSec) * fps));

      // Overlay transition dispatch. All three kinds apply to all mode
      // combinations now:
      //   - 'none':     hard cut (single-wrap, morphDurationMs=0).
      //   - 'animated': single-wrap morph. For a↔v the SVG morphs through
      //                 the pinch (translate + shrink + state change).
      //                 For v→v / a→a the state lerp is a no-op, so the
      //                 wrap just translates between corners.
      //   - 'crossfade': two-wrap, alpha-crossfaded. Each section's icon
      //                  renders at its own corner with its own state;
      //                  alphas fade across the morph window.
      const introMode = d.merchant!.spec.webcam.mode;
      const productMode = d.product!.spec.webcam.mode;
      const requestedOverlay = d.merge.transition.overlay;
      const overlayTransitionKind: "animated" | "crossfade" =
        requestedOverlay === "crossfade" ? "crossfade" : "animated";
      const morphDurationMs =
        requestedOverlay === "none" ? 0 : d.merge.transition.overlayDurationMs;

      logStep(
        `overlay decision: requested=${requestedOverlay} ` +
          `intro=${introMode} product=${productMode} ` +
          `→ kind=${overlayTransitionKind} morphDurationMs=${morphDurationMs}`,
      );

      const unifiedOverlay = await renderUnifiedMergeOverlay({
        intermediatesDir: mergeIntermediatesDir,
        width: d.merchant!.width,
        height: d.merchant!.height,
        zoom: 1.25,
        fps,
        totalOutputFrames,
        boundaryFrameIdx,
        introWebcam: d.merchant!.spec.webcam,
        introThrob: d.merchant!.spec.throb,
        introFrames: introBg.webcamFrames,
        introAmplitudeSamples: introBg.amplitudeSamples,
        introTrimStartSec,
        productWebcam: d.product!.spec.webcam,
        productThrob: d.product!.spec.throb,
        productFrames: productBg.webcamFrames,
        productAmplitudeSamples: productBg.amplitudeSamples,
        productTrimStartSec,
        morphDurationMs,
        transitionKind: overlayTransitionKind,
        onProgress: (rendered, total) => {
          // Surface unified-overlay progress as the FIRST half of step 2.
          if (total > 0) {
            updateStep(2, Math.round((rendered / total) * 50));
          }
        },
      });

      // Audio crossfade gating + chunk extraction (unchanged from v3 logic).
      const introHasAudio =
        d.merchant!.spec.webcam.mode !== "off" && !!d.merchant!.webcamR2Key;
      const productHasAudio =
        d.product!.spec.webcam.mode !== "off" && !!d.product!.webcamR2Key;
      const effectiveAudio =
        d.merge.transition.audio === "crossfade" && introHasAudio && productHasAudio
          ? "crossfade"
          : "none";

      logStep(
        `audio decision: ` +
          `route-effective=${d.merge.transition.audio} ` +
          `audioDurationMs=${d.merge.transition.audioDurationMs} ` +
          `introHasAudio=${introHasAudio} productHasAudio=${productHasAudio} ` +
          `→ workerEffectiveAudio=${effectiveAudio}`,
      );

      let introAudioTailPath: string | undefined;
      let productAudioHeadPath: string | undefined;
      if (effectiveAudio === "crossfade" && merchantWebcamLocalPath && productWebcamLocalPath) {
        const halfAudioSec = d.merge.transition.audioDurationMs / 2 / 1000;
        const introTrimEndSec = d.merchant!.spec.trim?.endSec ?? 0;
        const productTrimStartSec = d.product!.spec.trim?.startSec ?? 0;
        const productHeadStartSec = Math.max(0, productTrimStartSec - halfAudioSec);
        [introAudioTailPath, productAudioHeadPath] = await Promise.all([
          extractAudioChunk(
            merchantWebcamLocalPath,
            mergeOutputDir,
            introTrimEndSec,
            halfAudioSec,
            "intro-audio-tail",
          ),
          extractAudioChunk(
            productWebcamLocalPath,
            mergeOutputDir,
            productHeadStartSec,
            halfAudioSec,
            "product-audio-head",
          ),
        ]);
        const [introTailBytes, productHeadBytes] = await Promise.all([
          stat(introAudioTailPath).then((s) => s.size).catch(() => -1),
          stat(productAudioHeadPath).then((s) => s.size).catch(() => -1),
        ]);
        logStep(
          `audio borrow extracted: ` +
            `introAudioTail (${introTailBytes} bytes) productAudioHead (${productHeadBytes} bytes)`,
        );
      }

      // Cursor positions for the merged timeline (per OUTPUT frame).
      const cursorPositions = buildMergedCursorPositions(
        d.merchant!,
        introBg.fullDurationMs,
        d.product!,
        productBg.fullDurationMs,
        fps,
      );

      logStep("compose: composeLayeredMerge");
      const { mergedPath } = await composeLayeredMerge({
        outputDir: mergeOutputDir,
        outputName: d.brand,
        fps,
        width: d.merchant!.width,
        height: d.merchant!.height,
        intro: {
          backgroundVideoPath: introBg.backgroundPath,
          trimStartSec: d.merchant!.spec.trim?.startSec,
          trimEndSec: d.merchant!.spec.trim?.endSec,
          webcamPath: merchantWebcamLocalPath,
          muteAudio: d.merchant!.spec.webcam.mode === "off",
        },
        product: {
          backgroundVideoPath: productBg.backgroundPath,
          trimStartSec: d.product!.spec.trim?.startSec,
          trimEndSec: d.product!.spec.trim?.endSec,
          webcamPath: productWebcamLocalPath,
          muteAudio: d.product!.spec.webcam.mode === "off",
        },
        unifiedOverlayPath: unifiedOverlay.outputPath,
        transition: {
          audio: effectiveAudio,
          video: d.merge.transition.video,
          audioDurationMs: d.merge.transition.audioDurationMs,
          videoDurationMs: d.merge.transition.videoDurationMs,
          introAudioTailPath,
          productAudioHeadPath,
        },
        cursorSource: loadMergeCursorSource(),
        cursorSizePx: MERGE_CURSOR_SIZE_PX,
        cursorPositions,
        // Unified overlay was the first half of step 2 (0–50%); the FFmpeg
        // compose pass is the second half (50–100%).
        onProgress: (pct) => updateStep(2, 50 + Math.round(pct / 2)),
      });
      completeStep(2);

      // Final delivered video lands at renderDir/video.mp4 — outside
      // intermediates/. Share assets (poster.jpg, etc.) become path-derived
      // siblings via path.posix.dirname() in generateAndUploadShareAssets.
      finalR2Key = `${renderEntityDir}/video.mp4`;
      logStep(`upload final video: ${finalR2Key}`);
      const fileBuffer = await readFile(mergedPath);
      await uploadToR2(finalR2Key, fileBuffer, "video/mp4");
      finalLocalPath = mergedPath;
      posterSourceR2Key = introBg.backgroundR2Key;
    } else {
      // ---- Single-section: full produce (render → compose → trim) ----
      logStep(`single-section: ${hasIntro ? "intro" : "product"}`);
      const setSubTask = (stepIdx: number, subIdx: number, pct: number) => {
        const sub = steps[stepIdx].subTasks?.[subIdx];
        if (sub) sub.progress = pct;
        updateStep(stepIdx, steps[stepIdx].progress);
      };
      let soleResult: ProduceResult;
      if (hasIntro) {
        const merchantRec = await downloadRecording(
          d.merchant!.mouseEventsR2Key,
          d.merchant!.webcamR2Key,
          merchantDir,
        );
        soleResult = await renderMergeSection(
          mergeIntermediatesDir,
          "merchant",
          d.merchant!,
          merchantRec.webcamPath,
          (pct) => updateStep(0, pct),
          () => completeStep(0),
          (pct) => updateStep(1, pct),
          (pct) => setSubTask(0, 0, pct),
          (pct) => setSubTask(0, 1, pct),
        );
        completeStep(1);
      } else {
        const productRec = await downloadRecording(
          d.product!.mouseEventsR2Key,
          d.product!.webcamR2Key,
          productDir,
        );
        soleResult = await renderMergeSection(
          mergeIntermediatesDir,
          "product",
          d.product!,
          productRec.webcamPath,
          (pct) => updateStep(0, pct),
          () => completeStep(0),
          (pct) => updateStep(1, pct),
          (pct) => setSubTask(0, 0, pct),
          (pct) => setSubTask(0, 1, pct),
        );
        completeStep(1);
      }
      // Promote the produce intermediate (trim or composite) to the render's
      // canonical video.mp4 location. CopyObject is server-side — cheap.
      finalR2Key = `${renderEntityDir}/video.mp4`;
      logStep(`promote single-section final: ${soleResult.finalR2Key} → ${finalR2Key}`);
      await copyR2Object(soleResult.finalR2Key, finalR2Key);
      finalLocalPath = soleResult.finalPath;
      posterSourceR2Key = soleResult.backgroundR2Key;
    }

    logStep("share assets: poster + poster_square + gif");
    const { posterKey, posterSquareKey, gifKey } = await generateAndUploadShareAssets(
      finalLocalPath,
      finalR2Key,
      mergeOutputDir,
      posterSourceR2Key,
    );

    logStep(`finalize render row: renderId=${d.renderId} videoKey=${finalR2Key}`);
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
    if (job.data.type === "daily_digest_tick") {
      return processDailyDigestTick();
    }
    if (job.data.type === "weekly_digest_tick") {
      return processWeeklyDigestTick();
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

// Register recurring digest ticks. upsertJobScheduler is keyed on the
// scheduler id, so re-registering on every worker boot is idempotent — no
// duplicate schedules. tz pins the cron evaluation to Mountain Time so the
// 8am wake-up is local-clock-correct regardless of container TZ.
void jobsQueue.upsertJobScheduler(
  "daily-digest-tick",
  { pattern: "0 8 * * *", tz: "America/Denver" },
  { name: "daily_digest_tick", data: { type: "daily_digest_tick" } },
);
void jobsQueue.upsertJobScheduler(
  "weekly-digest-tick",
  { pattern: "0 8 * * 1", tz: "America/Denver" },
  { name: "weekly_digest_tick", data: { type: "weekly_digest_tick" } },
);

worker.on("completed", (job) => {
  console.log(`[worker] Job ${job.id} (${job.data.type}) completed`);
});

worker.on("failed", async (job, err) => {
  console.error(`[worker] Job ${job?.id} (${job?.data.type}) failed:`, err.message);
  // Persist stack trace into the per-job log so the admin UI can render it.
  // Awaited (unlike the in-flight logStep calls) — once the failed handler
  // returns, BullMQ moves the job into the failed set; we want this entry
  // to land before that transition.
  if (job) {
    try {
      await job.log(
        `${new Date().toISOString()} FAILED: ${err.message}\n${err.stack ?? "(no stack)"}`,
      );
    } catch (logErr) {
      console.error(`[worker] job.log() failed for ${job.id}:`, logErr);
    }
  }
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
  if (job && (job.data.type === "produce" || job.data.type === "merge")) {
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
