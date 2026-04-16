import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { requireSession, sanitizePresenter } from "@/lib/apiAuth";
import { TARGET_URL, DEFAULT_FPS, VIDEO_WIDTH, VIDEO_HEIGHT, RENDER_ZOOM } from "@/app/config";
import { eventsToKeyframes } from "@/lib/render/keyframes";
import { createReplayAction } from "@/lib/render/actions";
import { produceSessionVideo } from "@/lib/render/produce";
import {
  createJobAtStep,
  updateJobProgress,
  startCompositing,
  updateCompositingProgress,
  completeJob,
  failJob,
} from "@/lib/render/job-store";
import { type WebcamSettings, DEFAULT_WEBCAM_SETTINGS } from "@/types/webcam";
import {
  mouseJsonPath,
  hashMouseJson,
  hashUrl,
  webcamFingerprint,
  trimKey,
  readManifest,
  writeManifest,
  findCachedArtifacts,
  updateManifestFromResult,
} from "@/lib/manifest";

export const runtime = "nodejs";

type RequestBody = {
  product?: unknown;
  merchantId?: unknown;
  url?: unknown;
  webcamMode?: unknown;
  webcamVertical?: unknown;
  webcamHorizontal?: unknown;
  trimStartSec?: unknown;
  trimEndSec?: unknown;
};

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Derive identifier from product or merchantId
  const identifier = typeof body.product === "string" && body.product.trim()
    ? body.product.trim()
    : typeof body.merchantId === "string" && body.merchantId.trim()
    ? body.merchantId.trim()
    : null;

  if (!identifier) {
    return NextResponse.json({ error: "Missing product or merchantId." }, { status: 400 });
  }

  // URL is required — the target page to render
  if (typeof body.url !== "string" || !body.url.trim()) {
    return NextResponse.json({ error: "Missing url." }, { status: 400 });
  }

  const presenter = sanitizePresenter(session.email);
  const safeId = identifier.replace(/[^a-z0-9_\-]/gi, "_");
  const url = body.url.trim();
  const dirName = `${presenter}_${safeId}`;

  // Read mouse events
  const mousePath = mouseJsonPath(presenter, safeId);
  let mouseRaw: string;
  try {
    mouseRaw = await readFile(mousePath, "utf-8");
  } catch {
    return NextResponse.json({ error: "No recording found for this presenter + product/merchant." }, { status: 404 });
  }

  let mouseData: { events?: unknown; virtualWidth?: unknown; virtualHeight?: unknown };
  try {
    mouseData = JSON.parse(mouseRaw) as typeof mouseData;
  } catch {
    return NextResponse.json({ error: "Recording file is corrupt." }, { status: 500 });
  }

  if (
    !Array.isArray(mouseData.events) ||
    typeof mouseData.virtualWidth !== "number" ||
    typeof mouseData.virtualHeight !== "number"
  ) {
    return NextResponse.json({ error: "Recording file is missing required fields." }, { status: 400 });
  }

  const keyframes = eventsToKeyframes(mouseData.events as Parameters<typeof eventsToKeyframes>[0]);
  const durationMs = keyframes.length > 0 ? keyframes[keyframes.length - 1].t : 1000;
  const replayAction = createReplayAction(keyframes, durationMs);

  const webcamSettings: WebcamSettings = {
    webcamMode: typeof body.webcamMode === "string" && ["video", "audio", "off"].includes(body.webcamMode)
      ? body.webcamMode as WebcamSettings["webcamMode"]
      : DEFAULT_WEBCAM_SETTINGS.webcamMode,
    webcamVertical: typeof body.webcamVertical === "string" && ["top", "bottom"].includes(body.webcamVertical)
      ? body.webcamVertical as WebcamSettings["webcamVertical"]
      : DEFAULT_WEBCAM_SETTINGS.webcamVertical,
    webcamHorizontal: typeof body.webcamHorizontal === "string" && ["left", "right"].includes(body.webcamHorizontal)
      ? body.webcamHorizontal as WebcamSettings["webcamHorizontal"]
      : DEFAULT_WEBCAM_SETTINGS.webcamHorizontal,
  };

  const trimStartSec = typeof body.trimStartSec === "number" ? body.trimStartSec : undefined;
  const trimEndSec = typeof body.trimEndSec === "number" ? body.trimEndSec : undefined;

  // Compute cache keys
  const mouseHash = await hashMouseJson(mousePath);
  const urlHash = hashUrl(url);
  const wcFP = webcamFingerprint(webcamSettings);
  const tKey = trimKey(trimStartSec, trimEndSec);

  // Check manifest for cached artifacts
  const manifest = await readManifest(presenter, safeId);
  const cached = findCachedArtifacts(manifest, urlHash, mouseHash, wcFP, tKey);

  // Fully cached — return instantly
  if (cached.trimmedUrl) {
    return NextResponse.json({ videoUrl: cached.trimmedUrl });
  }

  // If step 3 and no trim needed (trimStart=0, trimEnd=0), the composite IS the final output
  if (cached.startFromStep === 3 && cached.compositeUrl && (!trimStartSec || trimStartSec === 0) && (!trimEndSec || trimEndSec === 0)) {
    return NextResponse.json({ videoUrl: cached.compositeUrl });
  }

  const step = cached.startFromStep;
  const jobId = randomUUID().slice(0, 8);
  createJobAtStep(jobId, step);

  produceSessionVideo({
    url,
    presenter,
    sessionName: dirName,
    width: mouseData.virtualWidth,
    height: mouseData.virtualHeight,
    videoWidth: VIDEO_WIDTH,
    videoHeight: VIDEO_HEIGHT,
    zoom: RENDER_ZOOM,
    fps: DEFAULT_FPS,
    durationMs,
    actions: [replayAction],
    onRenderProgress: (rendered, total) => updateJobProgress(jobId, rendered, total),
    onRenderComplete: () => startCompositing(jobId),
    onComposeProgress: (s, total) => updateCompositingProgress(jobId, s, total),
    webcamSettings,
    trimStartSec,
    trimEndSec,
    startFromStep: step,
    existingRenderPath: cached.renderPath,
    existingRenderUrl: cached.renderUrl,
    existingRenderDurationMs: cached.renderDurationMs,
    existingCompositePath: cached.compositePath,
    existingCompositeUrl: cached.compositeUrl,
  })
    .then(async (result) => {
      // Re-read manifest to avoid overwriting entries from concurrent requests
      const current = await readManifest(presenter, safeId);
      const updated = updateManifestFromResult(current, urlHash, url, mouseHash, wcFP, tKey, result);
      await writeManifest(presenter, safeId, updated);
      completeJob(jobId, result);
    })
    .catch((error: unknown) => {
      console.error("Produce failed", error);
      failJob(jobId, error instanceof Error ? error.message : "Render failed.");
    });

  return NextResponse.json({ jobId });
}
