import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { TARGET_URL, DEFAULT_FPS, VIDEO_WIDTH, VIDEO_HEIGHT, RENDER_ZOOM } from "@/app/config";
import { eventsToKeyframes } from "@/lib/render/keyframes";
import { createReplayAction } from "@/lib/render/actions";
import { produceSessionVideo } from "@/lib/render/produce";
import {
  createJob,
  updateJobProgress,
  startCompositing,
  updateCompositingProgress,
  completeJob,
  failJob,
} from "@/lib/render/job-store";
import { DEFAULT_WEBCAM_SETTINGS } from "@/types/webcam";

export const runtime = "nodejs";

const PUBLIC_DIR = path.join(process.cwd(), "public");

type RequestBody = {
  presenter?: unknown;
  session?: unknown;
  targetUrl?: unknown;
};

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (typeof body.presenter !== "string" || !body.presenter.trim()) {
    return NextResponse.json({ error: "Missing presenter." }, { status: 400 });
  }
  if (typeof body.session !== "string" || !body.session.trim()) {
    return NextResponse.json({ error: "Missing session." }, { status: 400 });
  }

  const safePresenter = body.presenter.replace(/[^a-z0-9_\-]/gi, "_");
  const safeName = body.session.replace(/[^a-z0-9_\-]/gi, "_");

  // Read mouse events
  const filePath = path.join(
    PUBLIC_DIR, "users", safePresenter, safeName, "recordings", `${safeName}_mouse.json`,
  );

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  let data: { events?: unknown; virtualWidth?: unknown; virtualHeight?: unknown };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return NextResponse.json({ error: "Session file is corrupt." }, { status: 500 });
  }

  if (
    !Array.isArray(data.events) ||
    typeof data.virtualWidth !== "number" ||
    typeof data.virtualHeight !== "number"
  ) {
    return NextResponse.json({ error: "Session file is missing required fields." }, { status: 400 });
  }

  const keyframes = eventsToKeyframes(data.events as Parameters<typeof eventsToKeyframes>[0]);
  const durationMs = keyframes.length > 0 ? keyframes[keyframes.length - 1].t : 1000;
  const replayAction = createReplayAction(keyframes, durationMs);

  // Read product from metadata for the target URL
  const metadataPath = path.join(
    PUBLIC_DIR, "users", safePresenter, safeName, "recordings", "metadata.json",
  );
  let product = "returns";
  let webcamSettings = DEFAULT_WEBCAM_SETTINGS;
  try {
    const meta = JSON.parse(await readFile(metadataPath, "utf-8")) as Record<string, unknown>;
    if (typeof meta.product === "string") product = meta.product;
    webcamSettings = {
      webcamMode: (typeof meta.webcamMode === "string" ? meta.webcamMode : DEFAULT_WEBCAM_SETTINGS.webcamMode) as typeof DEFAULT_WEBCAM_SETTINGS.webcamMode,
      webcamVertical: (typeof meta.webcamVertical === "string" ? meta.webcamVertical : DEFAULT_WEBCAM_SETTINGS.webcamVertical) as typeof DEFAULT_WEBCAM_SETTINGS.webcamVertical,
      webcamHorizontal: (typeof meta.webcamHorizontal === "string" ? meta.webcamHorizontal : DEFAULT_WEBCAM_SETTINGS.webcamHorizontal) as typeof DEFAULT_WEBCAM_SETTINGS.webcamHorizontal,
    };
  } catch {}

  // Build the target URL — use provided targetUrl as-is, otherwise TARGET_URL with product
  let url: string;
  if (typeof body.targetUrl === "string" && body.targetUrl.trim()) {
    url = body.targetUrl.trim();
  } else {
    const params = new URLSearchParams(product ? { product } : {});
    url = params.toString() ? `${TARGET_URL}?${params.toString()}` : TARGET_URL;
  }

  const jobId = randomUUID().slice(0, 8);
  createJob(jobId);

  // Same pipeline as preview: Playwright render → webcam composite
  // No trim for postprocess — user sets trim marks on this video
  produceSessionVideo({
    url,
    presenter: safePresenter,
    sessionName: safeName,
    width: data.virtualWidth,
    height: data.virtualHeight,
    videoWidth: VIDEO_WIDTH,
    videoHeight: VIDEO_HEIGHT,
    zoom: RENDER_ZOOM,
    fps: DEFAULT_FPS,
    durationMs,
    actions: [replayAction],
    onRenderProgress: (rendered, total) => updateJobProgress(jobId, rendered, total),
    onRenderComplete: () => startCompositing(jobId),
    onComposeProgress: (step, total) => updateCompositingProgress(jobId, step, total),
    webcamSettings,
  })
    .then((result) => completeJob(jobId, result.videoUrl))
    .catch((error: unknown) => {
      console.error("Postprocess render failed", error);
      failJob(jobId, error instanceof Error ? error.message : "Render failed.");
    });

  return NextResponse.json({ jobId });
}
