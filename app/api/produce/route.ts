import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { requireSession, sanitizePresenter } from "@/lib/apiAuth";
import { DEFAULT_FPS, VIDEO_WIDTH, VIDEO_HEIGHT, RENDER_ZOOM } from "@/app/config";
import { eventsToKeyframes } from "@/lib/render/keyframes";
import { type WebcamSettings, DEFAULT_WEBCAM_SETTINGS } from "@/types/webcam";
import { jobsQueue } from "@/lib/queue/connection";
import type { ProduceJobPayload } from "@/lib/queue/payloads";
import { downloadBufferFromR2, getPresignedUrl } from "@/lib/storage/r2";
import { findCachedRender } from "@/lib/cache/render-cache";
import { supabase } from "@/lib/db/supabase";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function webcamFingerprint(s: WebcamSettings): string {
  return `${s.webcamMode}_${s.webcamVertical}_${s.webcamHorizontal}`;
}

function trimKey(startSec: number | undefined, endSec: number | undefined): string {
  return `${(startSec ?? 0).toFixed(3)}_${(endSec ?? 0).toFixed(3)}`;
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

  const presenter = sanitizePresenter(session.email);
  const url = body.url.trim();
  const dirName = `${presenter}_${flowId}`;

  // Mouse + webcam source keys. If an existing vlad_recordings row owns this flowId,
  // prefer its stored URLs (handles reopened saved/draft recordings whose source
  // files may live at either sessions/ or recordings/).
  let mouseR2Key = `sessions/${presenter}/${flowId}/mouse.json`;
  let webcamR2Key: string | null = `sessions/${presenter}/${flowId}/webcam.webm`;

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

  // Read mouse events from R2
  let mouseBuffer: Buffer;
  try {
    mouseBuffer = await downloadBufferFromR2(mouseR2Key);
  } catch {
    return NextResponse.json({ error: "No recording found for this flow." }, { status: 404 });
  }

  let mouseData: { events?: unknown; virtualWidth?: unknown; virtualHeight?: unknown };
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
  const durationMs = keyframes.length > 0 ? keyframes[keyframes.length - 1].t : 1000;
  const settleHint = keyframes.length > 0 ? { x: keyframes[0].x, y: keyframes[0].y } : undefined;

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
  const preview = body.preview === true;
  const tier = preview ? "preview" : "full";
  const priority =
    typeof body.priority === "number" && Number.isFinite(body.priority)
      ? Math.max(1, Math.min(10, Math.round(body.priority)))
      : 1;

  // Compute cache keys
  const mouseHash = hashBuffer(mouseBuffer);
  const urlHash = hashUrl(url);
  const wcFP = webcamFingerprint(webcamSettings);
  const tKey = trimKey(trimStartSec, trimEndSec);

  // Check Redis cache for cached artifacts (keyed on flowId via safeId)
  const cached = await findCachedRender(presenter, flowId, urlHash, mouseHash, wcFP, tKey, tier);

  // Fully cached — presign and return
  if (cached.trimmedR2Key) {
    const presigned = await getPresignedUrl(cached.trimmedR2Key);
    return NextResponse.json({ videoUrl: presigned, videoR2Key: cached.trimmedR2Key });
  }

  // Composite cached + no trim needed → return composite
  if (cached.startFromStep === 3 && cached.compositeR2Key && (!trimStartSec || trimStartSec === 0) && (!trimEndSec || trimEndSec === 0)) {
    const presigned = await getPresignedUrl(cached.compositeR2Key);
    return NextResponse.json({ videoUrl: presigned, videoR2Key: cached.compositeR2Key });
  }

  const step = cached.startFromStep;

  const job = await jobsQueue.add("produce", {
    type: "produce",
    presenter,
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
    webcamSettings,
    webcamR2Key,
    trimStartSec,
    trimEndSec,
    startFromStep: step,
    existingRenderR2Key: cached.renderR2Key,
    existingRenderDurationMs: cached.renderDurationMs,
    existingCompositeR2Key: cached.compositeR2Key,
    urlHash,
    mouseHash,
    wcFingerprint: wcFP,
    trimKeyStr: tKey,
    preview,
    flowId,
  } satisfies ProduceJobPayload, {
    jobId: randomUUID().slice(0, 8),
    priority,
  });

  return NextResponse.json({ jobId: job.id });
}
