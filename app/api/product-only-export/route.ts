import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { requireSession, sanitizePresenter } from "@/lib/apiAuth";
import { DEFAULT_FPS, VIDEO_WIDTH, VIDEO_HEIGHT, RENDER_ZOOM, TARGET_URL } from "@/app/config";
import { eventsToKeyframes } from "@/lib/render/keyframes";
import { type WebcamSettings, DEFAULT_WEBCAM_SETTINGS } from "@/types/webcam";
import { jobsQueue } from "@/lib/queue/connection";
import type { ProduceJobPayload } from "@/lib/queue/payloads";
import { downloadBufferFromR2 } from "@/lib/storage/r2";
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

function extractWebcamSettings(meta: Record<string, unknown>): WebcamSettings {
  return {
    webcamMode: typeof meta.webcamMode === "string" && ["video", "audio", "off"].includes(meta.webcamMode)
      ? meta.webcamMode as WebcamSettings["webcamMode"]
      : DEFAULT_WEBCAM_SETTINGS.webcamMode,
    webcamVertical: typeof meta.webcamVertical === "string" && ["top", "bottom"].includes(meta.webcamVertical)
      ? meta.webcamVertical as WebcamSettings["webcamVertical"]
      : DEFAULT_WEBCAM_SETTINGS.webcamVertical,
    webcamHorizontal: typeof meta.webcamHorizontal === "string" && ["left", "right"].includes(meta.webcamHorizontal)
      ? meta.webcamHorizontal as WebcamSettings["webcamHorizontal"]
      : DEFAULT_WEBCAM_SETTINGS.webcamHorizontal,
  };
}

type RequestBody = {
  productRecordingId?: unknown;
  merchantBrand?: unknown;
};

type MerchantBrand = {
  websiteUrl: string;
  brandName: string;
};

function parseMerchantBrand(v: unknown): MerchantBrand | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.websiteUrl !== "string" || !o.websiteUrl.trim()) return null;
  if (typeof o.brandName !== "string") return null;
  return { websiteUrl: o.websiteUrl.trim(), brandName: o.brandName };
}

/**
 * Enqueues a single produce job that renders a product recording with a
 * `?brand=…` URL param, and tells the worker to insert a vlad_renders row on
 * completion. Caller hits this once per merchant chip.
 */
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

  const productRecordingId = typeof body.productRecordingId === "string" ? body.productRecordingId.trim() : "";
  if (!UUID_RE.test(productRecordingId)) {
    return NextResponse.json({ error: "Missing or invalid productRecordingId." }, { status: 400 });
  }

  const merchant = parseMerchantBrand(body.merchantBrand);
  if (!merchant) {
    return NextResponse.json({ error: "Missing or invalid merchantBrand." }, { status: 400 });
  }

  const { data: product, error: productErr } = await supabase
    .from("vlad_recordings")
    .select("id, user_id, type, name, product_name, mouse_events_url, webcam_url, metadata")
    .eq("id", productRecordingId)
    .single();

  if (productErr || !product) {
    return NextResponse.json({ error: "Product recording not found." }, { status: 404 });
  }
  if (product.user_id !== session.email) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  if (product.type !== "product") {
    return NextResponse.json({ error: "Recording is not a product." }, { status: 400 });
  }

  // Fetch mouse events for keyframes + cache hash. Same source the produce
  // route reads, so the cache key matches if a /api/produce render of the same
  // (product, brand) tuple already happened.
  let mouseBuffer: Buffer;
  try {
    mouseBuffer = await downloadBufferFromR2(product.mouse_events_url);
  } catch {
    return NextResponse.json({ error: "No mouse data found for product recording." }, { status: 404 });
  }

  let mouseData: { events?: unknown; virtualWidth?: unknown; virtualHeight?: unknown };
  try {
    mouseData = JSON.parse(mouseBuffer.toString("utf-8")) as typeof mouseData;
  } catch {
    return NextResponse.json({ error: "Product recording mouse data is corrupt." }, { status: 500 });
  }

  if (
    !Array.isArray(mouseData.events) ||
    typeof mouseData.virtualWidth !== "number" ||
    typeof mouseData.virtualHeight !== "number"
  ) {
    return NextResponse.json({ error: "Product mouse data missing required fields." }, { status: 400 });
  }

  const keyframes = eventsToKeyframes(mouseData.events as Parameters<typeof eventsToKeyframes>[0]);
  const durationMs = keyframes.length > 0 ? keyframes[keyframes.length - 1].t : 1000;
  const settleHint = keyframes.length > 0 ? { x: keyframes[0].x, y: keyframes[0].y } : undefined;

  const productMeta = (product.metadata ?? {}) as Record<string, unknown>;
  const webcamSettings = extractWebcamSettings(productMeta);
  const trimStartSec = typeof productMeta.trimStartSec === "number" ? productMeta.trimStartSec : undefined;
  const trimEndSec = typeof productMeta.trimEndSec === "number" ? productMeta.trimEndSec : undefined;

  // The iframe brand target rejects URLs with http(s):// — strip before passing.
  const cleanedBrandUrl = merchant.websiteUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const renderUrl = `${TARGET_URL}?product=${encodeURIComponent(product.product_name ?? "")}&brand=${encodeURIComponent(cleanedBrandUrl)}`;

  const presenter = sanitizePresenter(session.email);
  const urlHash = hashUrl(renderUrl);
  const mouseHash = hashBuffer(mouseBuffer);
  const wcFP = webcamFingerprint(webcamSettings);
  const tKey = trimKey(trimStartSec, trimEndSec);
  // vlad_renders.brand label: `{merchantBrand}-{productRecordingName}`. Falls
  // back to just the brand if the product recording somehow has no name.
  const renderLabel = product.name
    ? `${merchant.brandName}-${product.name}`
    : merchant.brandName;

  // Cache lookup — if we've already rendered this exact (product, brand, webcam, trim)
  // we can skip the render entirely and just create a vlad_renders row pointing at it.
  const cached = await findCachedRender(presenter, productRecordingId, urlHash, mouseHash, wcFP, tKey, "full");
  if (cached.trimmedR2Key) {
    const { data: renderRow, error: rErr } = await supabase
      .from("vlad_renders")
      .insert({
        product_recording_id: productRecordingId,
        merchant_recording_id: null,
        brand: renderLabel,
        video_url: cached.trimmedR2Key,
        status: "done",
        progress: 100,
        seen: false,
      })
      .select("id")
      .single();
    if (rErr) {
      return NextResponse.json({ error: "Failed to record cached render." }, { status: 500 });
    }
    return NextResponse.json({ cached: true, renderId: renderRow?.id, videoR2Key: cached.trimmedR2Key });
  }

  const newJobId = randomUUID().slice(0, 8);
  const dirName = `${presenter}_product-only_${productRecordingId}_${urlHash}`;

  const job = await jobsQueue.add(
    "produce",
    {
      type: "produce",
      presenter,
      safeId: productRecordingId,
      dirName,
      url: renderUrl,
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
      webcamR2Key: product.webcam_url,
      trimStartSec,
      trimEndSec,
      startFromStep: cached.startFromStep,
      existingRenderR2Key: cached.renderR2Key,
      existingRenderDurationMs: cached.renderDurationMs,
      existingCompositeR2Key: cached.compositeR2Key,
      urlHash,
      mouseHash,
      wcFingerprint: wcFP,
      trimKeyStr: tKey,
      preview: false,
      flowId: null,
      mergeRenderInsert: {
        productRecordingId,
        brand: renderLabel,
      },
    } satisfies ProduceJobPayload,
    {
      jobId: newJobId,
      priority: 5,
    },
  );

  return NextResponse.json({ jobId: job.id ?? newJobId });
}
