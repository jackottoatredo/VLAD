import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requireSession } from "@/lib/apiAuth";
import { shortJobId } from "@/lib/queue/jobId";
import { DEFAULT_FPS, VIDEO_WIDTH, VIDEO_HEIGHT, RENDER_ZOOM, TARGET_URL } from "@/app/config";
import { eventsToKeyframes } from "@/lib/render/keyframes";
import { jobsQueue } from "@/lib/queue/connection";
import type { ProduceJobPayload } from "@/lib/queue/payloads";
import { downloadBufferFromR2 } from "@/lib/storage/r2";
import { findCachedRender } from "@/lib/cache/render-cache";
import { supabase } from "@/lib/db/supabase";
import { joinNameParts, slugifyPart } from "@/lib/naming";
import { reserveUniqueName } from "@/lib/db/reserveName";
import {
  type RenderSpec,
  type SectionFormSettings,
  type Webcam,
  DEFAULT_THROB_MIN,
  DEFAULT_THROB_MAX,
  extractWebcamFromMetadata,
  resolveSectionWebcam,
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

type RequestBody = {
  productRecordingId?: unknown;
  merchantBrand?: unknown;
  /** Optional resolved form settings from the modal — when omitted the
   *  recording's metadata is used directly (legacy default). */
  productSettings?: unknown;
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

function parseSectionForm(v: unknown): SectionFormSettings | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const isSource = (s: unknown): s is SectionFormSettings["modeSource"] =>
    s === "self" || s === "other" || s === "custom";
  const isMode = (m: unknown): m is Webcam["mode"] => m === "video" || m === "audio" || m === "off";
  const isVert = (v: unknown): v is "top" | "bottom" => v === "top" || v === "bottom";
  const isHorz = (h: unknown): h is "left" | "right" => h === "left" || h === "right";

  if (!isSource(o.modeSource) || !isSource(o.positionSource)) return null;
  if (!isMode(o.customMode)) return null;
  const cp = o.customPosition as Record<string, unknown> | undefined;
  if (!cp || !isVert(cp.vertical) || !isHorz(cp.horizontal)) return null;

  return {
    modeSource: o.modeSource,
    customMode: o.customMode,
    positionSource: o.positionSource,
    customPosition: { vertical: cp.vertical, horizontal: cp.horizontal },
  };
}

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

  const productForm = parseSectionForm(body.productSettings);

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

  let mouseBuffer: Buffer;
  try {
    mouseBuffer = await downloadBufferFromR2(product.mouse_events_url);
  } catch {
    return NextResponse.json({ error: "No mouse data found for product recording." }, { status: 404 });
  }

  let mouseData: { events?: unknown; virtualWidth?: unknown; virtualHeight?: unknown; durationMs?: unknown };
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
  const durationMs = typeof mouseData.durationMs === "number" && mouseData.durationMs > 0
    ? mouseData.durationMs
    : keyframes.length > 0 ? keyframes[keyframes.length - 1].t : 1000;
  const settleHint = keyframes.length > 0 ? { x: keyframes[0].x, y: keyframes[0].y } : undefined;

  const productMeta = (product.metadata ?? {}) as Record<string, unknown>;
  const productSelfWebcam = extractWebcamFromMetadata(productMeta);
  // 'other' is undefined here — single-section flow falls back to self.
  const resolvedWebcam = resolveSectionWebcam(productForm, productSelfWebcam);

  const trimStartSec = typeof productMeta.trimStartSec === "number" ? productMeta.trimStartSec : undefined;
  const trimEndSec = typeof productMeta.trimEndSec === "number" ? productMeta.trimEndSec : undefined;

  const webcamR2Key: string | null = product.webcam_url ?? null;

  // Final-render flow (product-only export): enable throb on audio mode.
  const spec: RenderSpec = {
    webcam: resolvedWebcam,
    throb: resolvedWebcam.mode === "audio" && webcamR2Key
      ? {
          enabled: true,
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

  const cleanedBrandUrl = merchant.websiteUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const renderUrl = `${TARGET_URL}?product=${encodeURIComponent(product.product_name ?? "")}&brand=${encodeURIComponent(cleanedBrandUrl)}`;

  const userId = session.email;
  const urlHash = hashUrl(renderUrl);
  const mouseHash = hashBuffer(mouseBuffer);
  const specHash = hashSpec(spec);
  const tKey = trimKeyOf(spec);

  const merchantNameSlug = slugifyPart(merchant.brandName);
  if (!merchantNameSlug) {
    return NextResponse.json({ error: "Merchant brand name is missing." }, { status: 400 });
  }
  if (!product.name) {
    return NextResponse.json({ error: "Product recording has no name." }, { status: 400 });
  }
  if (!product.product_name) {
    return NextResponse.json({ error: "Product recording has no product_name (SKU)." }, { status: 400 });
  }

  const brandBase = joinNameParts([merchantNameSlug, product.name]);
  const brand = await reserveUniqueName({
    table: "vlad_renders",
    column: "brand",
    userId,
    base: brandBase,
  });

  const slugBase = joinNameParts([merchantNameSlug, product.product_name]);
  const slug = await reserveUniqueName({
    table: "vlad_renders",
    column: "slug",
    base: slugBase,
  });

  const cached = await findCachedRender(userId, productRecordingId, urlHash, mouseHash, specHash, tKey, "full");
  if (cached.trimmedR2Key) {
    const { data: renderRow, error: rErr } = await supabase
      .from("vlad_renders")
      .insert({
        user_id: userId,
        product_recording_id: productRecordingId,
        merchant_recording_id: null,
        brand,
        brand_name: merchant.brandName || null,
        brand_url: cleanedBrandUrl,
        product_name: product.product_name,
        video_url: cached.trimmedR2Key,
        slug,
        status: "done",
        progress: 100,
        seen: false,
      })
      .select("id")
      .single();
    if (rErr) {
      return NextResponse.json({ error: "Failed to record cached render." }, { status: 500 });
    }
    return NextResponse.json({ cached: true, renderId: renderRow?.id, videoR2Key: cached.trimmedR2Key, slug });
  }

  const newJobId = shortJobId();

  const { data: stub, error: stubErr } = await supabase
    .from("vlad_renders")
    .insert({
      user_id: userId,
      job_id: newJobId,
      job_request: { endpoint: "/api/product-only-export", body },
      product_recording_id: productRecordingId,
      merchant_recording_id: null,
      brand,
      brand_name: merchant.brandName || null,
      brand_url: cleanedBrandUrl,
      product_name: product.product_name,
      slug,
      status: "rendering",
      progress: 0,
      seen: false,
    })
    .select("id")
    .single();
  if (stubErr || !stub) {
    return NextResponse.json({ error: "Failed to create render row." }, { status: 500 });
  }
  const renderId = stub.id as string;

  const job = await jobsQueue.add(
    "produce",
    {
      type: "produce",
      userId,
      safeId: productRecordingId,
      // Owner is the render row (mergeRenderInsert below), but the cache
      // safeId remains the source recording so cache lookups can still hit
      // intermediates produced by other product-only-exports of the same
      // recording. The worker uses mergeRenderInsert.renderId as the R2
      // entity prefix for both intermediates and final video.
      section: "product",
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
      spec,
      webcamR2Key,
      startFromStep: cached.startFromStep,
      existingBackgroundR2Key: cached.backgroundR2Key,
      existingOverlayR2Key: cached.overlayR2Key,
      existingRenderDurationMs: cached.renderDurationMs,
      existingCompositeR2Key: cached.compositeR2Key,
      urlHash,
      mouseHash,
      specHash,
      trimKeyStr: tKey,
      preview: false,
      flowId: null,
      mergeRenderInsert: { renderId },
    } satisfies ProduceJobPayload,
    {
      jobId: newJobId,
      priority: 5,
    },
  );

  return NextResponse.json({ jobId: job.id ?? newJobId, renderId, slug });
}
