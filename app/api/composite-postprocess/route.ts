import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
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

export const runtime = "nodejs";

const PUBLIC_DIR = path.join(process.cwd(), "public");

type RequestBody = {
  presenter?: unknown;
  session?: unknown;
  targetUrl?: unknown;
  product?: unknown;
  webcamMode?: unknown;
  webcamVertical?: unknown;
  webcamHorizontal?: unknown;
  trimStartSec?: unknown;
  trimEndSec?: unknown;
  // Warm-start fields
  startFromStep?: unknown;
  existingRenderPath?: unknown;
  existingRenderUrl?: unknown;
  existingRenderDurationMs?: unknown;
  existingCompositePath?: unknown;
  existingCompositeUrl?: unknown;
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

  const startFromStep = (body.startFromStep === 2 || body.startFromStep === 3) ? body.startFromStep : 1;

  // Validate warm-start fields
  if (startFromStep >= 2) {
    if (typeof body.existingRenderPath !== "string" || typeof body.existingRenderUrl !== "string" || typeof body.existingRenderDurationMs !== "number") {
      return NextResponse.json({ error: "Warm-start from step 2 requires existingRenderPath, existingRenderUrl, and existingRenderDurationMs." }, { status: 400 });
    }
    if (!existsSync(body.existingRenderPath)) {
      return NextResponse.json({ error: "Cached render file not found on disk." }, { status: 404 });
    }
  }
  if (startFromStep >= 3) {
    if (typeof body.existingCompositePath !== "string" || typeof body.existingCompositeUrl !== "string") {
      return NextResponse.json({ error: "Warm-start from step 3 requires existingCompositePath and existingCompositeUrl." }, { status: 400 });
    }
    if (!existsSync(body.existingCompositePath)) {
      return NextResponse.json({ error: "Cached composite file not found on disk." }, { status: 404 });
    }
  }

  // Read mouse events from disk (needed for step 1 replay)
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

  const product = typeof body.product === "string" && body.product.trim() ? body.product.trim() : "returns";

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

  let url: string;
  if (typeof body.targetUrl === "string" && body.targetUrl.trim()) {
    url = body.targetUrl.trim();
  } else {
    const params = new URLSearchParams(product ? { product } : {});
    url = params.toString() ? `${TARGET_URL}?${params.toString()}` : TARGET_URL;
  }

  const jobId = randomUUID().slice(0, 8);
  createJobAtStep(jobId, startFromStep as 1 | 2 | 3);

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
    trimStartSec,
    trimEndSec,
    startFromStep: startFromStep as 1 | 2 | 3,
    existingRenderPath: typeof body.existingRenderPath === "string" ? body.existingRenderPath : undefined,
    existingRenderUrl: typeof body.existingRenderUrl === "string" ? body.existingRenderUrl : undefined,
    existingRenderDurationMs: typeof body.existingRenderDurationMs === "number" ? body.existingRenderDurationMs : undefined,
    existingCompositePath: typeof body.existingCompositePath === "string" ? body.existingCompositePath : undefined,
    existingCompositeUrl: typeof body.existingCompositeUrl === "string" ? body.existingCompositeUrl : undefined,
  })
    .then((result) => completeJob(jobId, result))
    .catch((error: unknown) => {
      console.error("Postprocess render failed", error);
      failJob(jobId, error instanceof Error ? error.message : "Render failed.");
    });

  return NextResponse.json({ jobId });
}
