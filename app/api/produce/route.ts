import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requireSession } from "@/lib/apiAuth";
import { shortJobId } from "@/lib/queue/jobId";
import { DEFAULT_FPS, VIDEO_WIDTH, VIDEO_HEIGHT, RENDER_ZOOM } from "@/app/config";
import { eventsToKeyframes } from "@/lib/render/keyframes";
import { jobsQueue } from "@/lib/queue/connection";
import type { ProduceJobPayload } from "@/lib/queue/payloads";
import { downloadBufferFromR2, getPresignedUrl } from "@/lib/storage/r2";
import { findCachedRender } from "@/lib/cache/render-cache";
import { supabase } from "@/lib/db/supabase";
import {
  type RenderSpec,
  type WebcamPosition,
  type Webcam,
  DEFAULT_WEBCAM,
  DEFAULT_THROB_MIN,
  DEFAULT_THROB_MAX,
  hashSpec,
  trimKeyOf,
} from "@/lib/render/spec";
import { amplitudeKeyForWebcam } from "@/lib/audio/amplitude";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function parseWebcam(
  body: Record<string, unknown>,
): Webcam {
  const mode =
    typeof body.webcamMode === "string" && ["video", "audio", "off"].includes(body.webcamMode)
      ? (body.webcamMode as Webcam["mode"])
      : DEFAULT_WEBCAM.mode;
  const vertical: WebcamPosition["vertical"] =
    typeof body.webcamVertical === "string" && ["top", "bottom"].includes(body.webcamVertical)
      ? (body.webcamVertical as WebcamPosition["vertical"])
      : DEFAULT_WEBCAM.position.vertical;
  const horizontal: WebcamPosition["horizontal"] =
    typeof body.webcamHorizontal === "string" && ["left", "right"].includes(body.webcamHorizontal)
      ? (body.webcamHorizontal as WebcamPosition["horizontal"])
      : DEFAULT_WEBCAM.position.horizontal;
  return { mode, position: { vertical, horizontal } };
}

type RequestBody = {
  flowId?: unknown;
  product?: unknown;
  merchantId?: unknown;
  url?: unknown;
  webcamMode?: unknown;
  webcamVertical?: unknown;
  webcamHorizontal?: unknown;
  trimStartSec?: unknown;
  trimEndSec?: unknown;
  preview?: unknown;
  priority?: unknown;
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

  const flowId = typeof body.flowId === "string" ? body.flowId.trim() : "";
  if (!UUID_RE.test(flowId)) {
    return NextResponse.json({ error: "Missing or invalid flowId." }, { status: 400 });
  }

  const identifier = typeof body.product === "string" && body.product.trim()
    ? body.product.trim()
    : typeof body.merchantId === "string" && body.merchantId.trim()
    ? body.merchantId.trim()
    : null;

  if (!identifier) {
    return NextResponse.json({ error: "Missing product or merchantId." }, { status: 400 });
  }

  if (typeof body.url !== "string" || !body.url.trim()) {
    return NextResponse.json({ error: "Missing url." }, { status: 400 });
  }

  const userId = session.email;
  const url = body.url.trim();
  const dirName = `${userId}_${flowId}`;

  let mouseR2Key = `sessions/${userId}/${flowId}/mouse.json`;
  let webcamR2Key: string | null = `sessions/${userId}/${flowId}/webcam.webm`;

  const { data: existingRow } = await supabase
    .from("vlad_recordings")
    .select("id, user_id, mouse_events_url, webcam_url")
    .eq("id", flowId)
    .maybeSingle();

  if (existingRow) {
    if (existingRow.user_id !== session.email) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    if (typeof existingRow.mouse_events_url === "string" && existingRow.mouse_events_url) {
      mouseR2Key = existingRow.mouse_events_url;
    }
    webcamR2Key = typeof existingRow.webcam_url === "string" && existingRow.webcam_url
      ? existingRow.webcam_url
      : null;
  }

  let mouseBuffer: Buffer;
  try {
    mouseBuffer = await downloadBufferFromR2(mouseR2Key);
  } catch {
    return NextResponse.json({ error: "No recording found for this flow." }, { status: 404 });
  }

  let mouseData: { events?: unknown; virtualWidth?: unknown; virtualHeight?: unknown; durationMs?: unknown };
  try {
    mouseData = JSON.parse(mouseBuffer.toString("utf-8")) as typeof mouseData;
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
  // Prefer the explicit stop-click duration captured by the client. Falls back to
  // last-keyframe time for legacy mouse.json files saved before durationMs existed.
  const durationMs = typeof mouseData.durationMs === "number" && mouseData.durationMs > 0
    ? mouseData.durationMs
    : keyframes.length > 0 ? keyframes[keyframes.length - 1].t : 1000;
  const settleHint = keyframes.length > 0 ? { x: keyframes[0].x, y: keyframes[0].y } : undefined;

  const webcam = parseWebcam(body as Record<string, unknown>);
  const trimStartSec = typeof body.trimStartSec === "number" ? body.trimStartSec : undefined;
  const trimEndSec = typeof body.trimEndSec === "number" ? body.trimEndSec : undefined;
  const preview = body.preview === true;
  const tier = preview ? "preview" : "full";
  const priority =
    typeof body.priority === "number" && Number.isFinite(body.priority)
      ? Math.max(1, Math.min(10, Math.round(body.priority)))
      : 1;

  // Recording flow: throb disabled (per user spec — no animation in single-section
  // postprocessing). Audio mode shows a static circle.
  const spec: RenderSpec = {
    webcam,
    throb: webcam.mode === "audio" && webcamR2Key
      ? {
          enabled: false,
          amplitudeKey: amplitudeKeyForWebcam(webcamR2Key),
          minScale: DEFAULT_THROB_MIN,
          maxScale: DEFAULT_THROB_MAX,
        }
      : undefined,
    trim:
      trimStartSec || trimEndSec
        ? { startSec: trimStartSec ?? 0, endSec: trimEndSec ?? 0 }
        : undefined,
  };

  const mouseHash = hashBuffer(mouseBuffer);
  const urlHash = hashUrl(url);
  const specHash = hashSpec(spec);
  const tKey = trimKeyOf(spec);

  const cached = await findCachedRender(userId, flowId, urlHash, mouseHash, specHash, tKey, tier);

  // Fully cached at the trim sub-stage → return the trimmed mp4 directly.
  if (cached.trimmedR2Key) {
    const presigned = await getPresignedUrl(cached.trimmedR2Key);
    return NextResponse.json({ videoUrl: presigned, videoR2Key: cached.trimmedR2Key });
  }

  // Composite cached + no trim requested → return the composite directly.
  // (When trim values are set we still need to run the trim stage even on
  // a composite cache hit, so we fall through to the worker.)
  if (
    cached.startFromStep === 3 &&
    cached.compositeR2Key &&
    (!trimStartSec || trimStartSec === 0) &&
    (!trimEndSec || trimEndSec === 0)
  ) {
    const presigned = await getPresignedUrl(cached.compositeR2Key);
    return NextResponse.json({ videoUrl: presigned, videoR2Key: cached.compositeR2Key });
  }

  const job = await jobsQueue.add("produce", {
    type: "produce",
    userId,
    safeId: flowId,
    dirName,
    url,
    width: mouseData.virtualWidth,
    height: mouseData.virtualHeight,
    videoWidth: VIDEO_WIDTH,
    videoHeight: VIDEO_HEIGHT,
    zoom: RENDER_ZOOM,
    fps: DEFAULT_FPS,
    durationMs,
    keyframes,
    settleHint,
    spec,
    webcamR2Key,
    startFromStep: cached.startFromStep,
    existingRenderR2Key: cached.renderR2Key,
    existingRenderDurationMs: cached.renderDurationMs,
    existingCompositeR2Key: cached.compositeR2Key,
    urlHash,
    mouseHash,
    specHash,
    trimKeyStr: tKey,
    preview,
    flowId,
  } satisfies ProduceJobPayload, {
    jobId: shortJobId(),
    priority,
  });

  return NextResponse.json({ jobId: job.id });
}
