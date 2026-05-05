import { Worker, Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { REDIS_CONNECTION, QUEUE_NAME } from "@/lib/queue/connection";
import type { JobPayload, ProduceJobPayload, MergeJobPayload, MergeRecordingPayload } from "@/lib/queue/payloads";
import type { JobProgress, JobStep } from "@/lib/queue/progress";
import { createReplayAction } from "@/lib/render/actions";
import { produceSessionVideo, type ProduceResult } from "@/lib/render/produce";
import { renderBackgroundToMp4 } from "@/lib/render/render-background";
import { renderOverlayToWebm } from "@/lib/render/render-overlay";
import { composeLayeredMerge, extractAudioChunk } from "@/lib/render/merge";
import { computeCursorPositions } from "@/lib/render/cursor-track";
import { readFileSync } from "node:fs";
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
        result.backgroundR2Key,
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
  userId: string,
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

type LayerRenderResult = {
  backgroundPath: string;
  backgroundR2Key: string;
  overlayPath: string;
  overlayR2Key: string;
  fullDurationMs: number;
};

async function renderMergeSectionLayers(
  userId: string,
  recording: MergeRecordingPayload,
  onRenderProgress: (pct: number) => void,
  onBackgroundProgress?: (pct: number) => void,
  onOverlayProgress?: (pct: number) => void,
): Promise<LayerRenderResult> {
  const [amplitudeSamples, webcamFrames] = await Promise.all([
    resolveAmplitudeSamples(recording.spec, recording.webcamR2Key),
    resolveWebcamFrames(recording.webcamR2Key),
  ]);
  const actions = buildActions(recording.spec, recording.keyframes, recording.durationMs);

  // Combined progress = avg(bg, ov). Two browser contexts run in parallel
  // inside this process; total wall-clock ≈ 1.0–1.3× a single pass.
  let bgPct = 0;
  let ovPct = 0;
  const report = () => onRenderProgress(Math.round((bgPct + ovPct) / 2));

  const [bg, ov] = await Promise.all([
    renderBackgroundToMp4({
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
      onProgress(rendered, total) {
        bgPct = total > 0 ? Math.round((rendered / total) * 100) : 0;
        onBackgroundProgress?.(bgPct);
        report();
      },
    }),
    renderOverlayToWebm({
      userId,
      sessionName: recording.sessionName,
      width: recording.width,
      height: recording.height,
      videoWidth: recording.width,
      videoHeight: recording.height,
      fps: 30,
      durationMs: recording.durationMs,
      spec: recording.spec,
      webcamFrames,
      amplitudeSamples,
      onProgress(rendered, total) {
        ovPct = total > 0 ? Math.round((rendered / total) * 100) : 0;
        onOverlayProgress?.(ovPct);
        report();
      },
    }),
  ]);

  return {
    backgroundPath: bg.outputPath,
    backgroundR2Key: bg.videoUrl,
    overlayPath: ov.outputPath,
    overlayR2Key: ov.videoUrl,
    fullDurationMs: bg.totalDurationMs,
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
    let finalDirOnR2: string;
    let posterSourceR2Key: string;

    if (dualSection) {
      // ---- Dual-section: layered render → layered merge ----
      // Per section, render the page (background) and overlay (transparent
      // webcam circle / audio icon) as independent layers — no per-section
      // compose/trim. The merge stage composites everything in one pass so
      // the background xfade can blend cleanly without cross-dissolving the
      // webcam overlay.

      const [merchantRec, productRec] = await Promise.all([
        downloadRecording(d.merchant!.mouseEventsR2Key, d.merchant!.webcamR2Key, merchantDir),
        downloadRecording(d.product!.mouseEventsR2Key, d.product!.webcamR2Key, productDir),
      ]);
      const merchantWebcamLocalPath = merchantRec.webcamPath;
      const productWebcamLocalPath = productRec.webcamPath;

      const setSubTask = (stepIdx: number, subIdx: number, pct: number) => {
        const sub = steps[stepIdx].subTasks?.[subIdx];
        if (sub) sub.progress = pct;
        updateStep(stepIdx, steps[stepIdx].progress);
      };

      const introLayers = await renderMergeSectionLayers(
        userId,
        d.merchant!,
        (pct) => updateStep(0, pct),
        (pct) => setSubTask(0, 0, pct),
        (pct) => setSubTask(0, 1, pct),
      );
      completeStep(0);

      const productLayers = await renderMergeSectionLayers(
        userId,
        d.product!,
        (pct) => updateStep(1, pct),
        (pct) => setSubTask(1, 0, pct),
        (pct) => setSubTask(1, 1, pct),
      );
      completeStep(1);

      // Audio crossfade gating + chunk extraction (unchanged from v3 logic).
      const introHasAudio =
        d.merchant!.spec.webcam.mode !== "off" && !!d.merchant!.webcamR2Key;
      const productHasAudio =
        d.product!.spec.webcam.mode !== "off" && !!d.product!.webcamR2Key;
      const effectiveAudio =
        d.merge.transition.audio === "crossfade" && introHasAudio && productHasAudio
          ? "crossfade"
          : "none";

      console.log(
        `[merge ${jobId}] audio decision: ` +
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
        console.log(
          `[merge ${jobId}] audio borrow extracted: ` +
            `introAudioTail (${introTailBytes} bytes) productAudioHead (${productHeadBytes} bytes)`,
        );
      }

      // Cursor positions for the merged timeline (per OUTPUT frame).
      console.log(
        `[merge ${jobId}] cursor track: ` +
          `intro.mouseTrack=${JSON.stringify(d.merchant!.spec.mouseTrack ?? null)} ` +
          `product.mouseTrack=${JSON.stringify(d.product!.spec.mouseTrack ?? null)}`,
      );
      const cursorPositions = buildMergedCursorPositions(
        d.merchant!,
        introLayers.fullDurationMs,
        d.product!,
        productLayers.fullDurationMs,
        30,
      );
      console.log(
        `[merge ${jobId}] cursor positions: ${cursorPositions.length} frames; ` +
          `first=${JSON.stringify(cursorPositions[0])} ` +
          `last=${JSON.stringify(cursorPositions[cursorPositions.length - 1])} ` +
          `(if intro.mouseTrack/product.mouseTrack are null, the route emitted no glide ` +
          `— set transition.mouse to linear/arched/natural)`,
      );

      const { mergedPath } = await composeLayeredMerge({
        outputDir: mergeOutputDir,
        outputName: d.brand,
        fps: 30,
        width: d.merchant!.width,
        height: d.merchant!.height,
        intro: {
          backgroundVideoPath: introLayers.backgroundPath,
          overlayVideoPath: introLayers.overlayPath,
          trimStartSec: d.merchant!.spec.trim?.startSec,
          trimEndSec: d.merchant!.spec.trim?.endSec,
          webcamPath: merchantWebcamLocalPath,
          muteAudio: d.merchant!.spec.webcam.mode === "off",
        },
        product: {
          backgroundVideoPath: productLayers.backgroundPath,
          overlayVideoPath: productLayers.overlayPath,
          trimStartSec: d.product!.spec.trim?.startSec,
          trimEndSec: d.product!.spec.trim?.endSec,
          webcamPath: productWebcamLocalPath,
          muteAudio: d.product!.spec.webcam.mode === "off",
        },
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
        onProgress: (pct) => updateStep(2, pct),
      });
      completeStep(2);

      finalR2Key = `merges/${userId}/${d.outputSessionName}/${path.basename(mergedPath)}`;
      const fileBuffer = await readFile(mergedPath);
      await uploadToR2(finalR2Key, fileBuffer, "video/mp4");
      finalLocalPath = mergedPath;
      finalDirOnR2 = path.posix.dirname(finalR2Key);
      posterSourceR2Key = introLayers.backgroundR2Key;
    } else {
      // ---- Single-section: full produce (render → compose → trim) ----
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
          userId,
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
          userId,
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
      finalR2Key = soleResult.finalR2Key;
      finalLocalPath = soleResult.finalPath;
      finalDirOnR2 = path.posix.dirname(finalR2Key);
      posterSourceR2Key = soleResult.backgroundR2Key;
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
