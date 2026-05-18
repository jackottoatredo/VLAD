import { createHash } from "node:crypto";
import { DEFAULT_FPS, VIDEO_WIDTH, VIDEO_HEIGHT, RENDER_ZOOM, TARGET_URL } from "@/app/config";
import { eventsToKeyframes } from "@/lib/render/keyframes";
import { jobsQueue } from "@/lib/queue/connection";
import type { ProduceJobPayload } from "@/lib/queue/payloads";
import { shortJobId } from "@/lib/queue/jobId";
import { downloadBufferFromR2 } from "@/lib/storage/r2";
import { findCachedRender } from "@/lib/cache/render-cache";
import { supabase } from "@/lib/db/supabase";
import { joinNameParts, slugifyPart } from "@/lib/naming";
import { reserveUniqueName } from "@/lib/db/reserveName";
import {
  type RenderSpec,
  type SectionFormSettings,
  DEFAULT_THROB_MIN,
  DEFAULT_THROB_MAX,
  extractWebcamFromMetadata,
  resolveSectionWebcam,
  hashSpec,
  trimKeyOf,
} from "@/lib/render/spec";
import { amplitudeKeyForWebcam } from "@/lib/audio/amplitude";

export type ProduceProductOnlyInput = {
  /** VLAD user (email) that will own the resulting render row. */
  userId: string;
  productRecordingId: string;
  merchantBrand: { websiteUrl: string; brandName: string };
  /** Optional resolved form settings; falls back to recording metadata. */
  productSettings?: SectionFormSettings | null;
  /** Skip the render cache check and always queue a fresh job. */
  force?: boolean;
  /** Stored verbatim in vlad_renders.job_request for retry/replay. */
  jobRequestBody: unknown;
};

export type ProduceProductOnlyResult =
  | { kind: "cached"; renderId: string; videoR2Key: string; slug: string }
  | { kind: "enqueued"; renderId: string; jobId: string; slug: string };

export type ProduceProductOnlyErrorCode =
  | "recording_not_found"
  | "forbidden"
  | "recording_wrong_type"
  | "mouse_data_missing"
  | "mouse_data_corrupt"
  | "mouse_data_invalid_fields"
  | "merchant_name_invalid"
  | "recording_name_missing"
  | "recording_product_name_missing"
  | "db_insert_failed";

export type ProduceProductOnlyOutcome =
  | { ok: true; result: ProduceProductOnlyResult }
  | {
      ok: false;
      code: ProduceProductOnlyErrorCode;
      status: number;
      message: string;
    };

function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export async function produceProductOnly(
  input: ProduceProductOnlyInput,
): Promise<ProduceProductOnlyOutcome> {
  const { userId, productRecordingId, merchantBrand, productSettings, jobRequestBody } = input;

  const { data: product, error: productErr } = await supabase
    .from("vlad_recordings")
    .select("id, user_id, type, name, product_name, mouse_events_url, webcam_url, metadata")
    .eq("id", productRecordingId)
    .single();

  if (productErr || !product) {
    return { ok: false, code: "recording_not_found", status: 404, message: "Product recording not found." };
  }
  if (product.user_id !== userId) {
    return { ok: false, code: "forbidden", status: 403, message: "Forbidden." };
  }
  if (product.type !== "product") {
    return { ok: false, code: "recording_wrong_type", status: 400, message: "Recording is not a product." };
  }

  let mouseBuffer: Buffer;
  try {
    mouseBuffer = await downloadBufferFromR2(product.mouse_events_url);
  } catch {
    return { ok: false, code: "mouse_data_missing", status: 404, message: "No mouse data found for product recording." };
  }

  let mouseData: { events?: unknown; virtualWidth?: unknown; virtualHeight?: unknown; durationMs?: unknown };
  try {
    mouseData = JSON.parse(mouseBuffer.toString("utf-8")) as typeof mouseData;
  } catch {
    return { ok: false, code: "mouse_data_corrupt", status: 500, message: "Product recording mouse data is corrupt." };
  }

  if (
    !Array.isArray(mouseData.events) ||
    typeof mouseData.virtualWidth !== "number" ||
    typeof mouseData.virtualHeight !== "number"
  ) {
    return { ok: false, code: "mouse_data_invalid_fields", status: 400, message: "Product mouse data missing required fields." };
  }

  const keyframes = eventsToKeyframes(mouseData.events as Parameters<typeof eventsToKeyframes>[0]);
  const durationMs = typeof mouseData.durationMs === "number" && mouseData.durationMs > 0
    ? mouseData.durationMs
    : keyframes.length > 0 ? keyframes[keyframes.length - 1].t : 1000;
  const settleHint = keyframes.length > 0 ? { x: keyframes[0].x, y: keyframes[0].y } : undefined;

  const productMeta = (product.metadata ?? {}) as Record<string, unknown>;
  const productSelfWebcam = extractWebcamFromMetadata(productMeta);
  const resolvedWebcam = resolveSectionWebcam(productSettings ?? null, productSelfWebcam);

  const trimStartSec = typeof productMeta.trimStartSec === "number" ? productMeta.trimStartSec : undefined;
  const trimEndSec = typeof productMeta.trimEndSec === "number" ? productMeta.trimEndSec : undefined;

  const webcamR2Key: string | null = product.webcam_url ?? null;

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

  const cleanedBrandUrl = merchantBrand.websiteUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const renderUrl = `${TARGET_URL}?product=${encodeURIComponent(product.product_name ?? "")}&brand=${encodeURIComponent(cleanedBrandUrl)}`;
  const urlHash = hashUrl(renderUrl);
  const mouseHash = hashBuffer(mouseBuffer);
  const specHash = hashSpec(spec);
  const tKey = trimKeyOf(spec);

  const merchantNameSlug = slugifyPart(merchantBrand.brandName);
  if (!merchantNameSlug) {
    return { ok: false, code: "merchant_name_invalid", status: 400, message: "Merchant brand name is missing." };
  }
  if (!product.name) {
    return { ok: false, code: "recording_name_missing", status: 400, message: "Product recording has no name." };
  }
  if (!product.product_name) {
    return { ok: false, code: "recording_product_name_missing", status: 400, message: "Product recording has no product_name (SKU)." };
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

  const cached = input.force
    ? { startFromStep: 1 as const }
    : await findCachedRender(userId, productRecordingId, urlHash, mouseHash, specHash, tKey, "full");
  if ("trimmedR2Key" in cached && cached.trimmedR2Key) {
    const { data: renderRow, error: rErr } = await supabase
      .from("vlad_renders")
      .insert({
        user_id: userId,
        product_recording_id: productRecordingId,
        merchant_recording_id: null,
        brand,
        brand_name: merchantBrand.brandName || null,
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
    if (rErr || !renderRow) {
      return { ok: false, code: "db_insert_failed", status: 500, message: "Failed to record cached render." };
    }
    return {
      ok: true,
      result: { kind: "cached", renderId: renderRow.id as string, videoR2Key: cached.trimmedR2Key, slug },
    };
  }

  const newJobId = shortJobId();

  const { data: stub, error: stubErr } = await supabase
    .from("vlad_renders")
    .insert({
      user_id: userId,
      job_id: newJobId,
      job_request: { endpoint: "/api/product-only-export", body: jobRequestBody },
      product_recording_id: productRecordingId,
      merchant_recording_id: null,
      brand,
      brand_name: merchantBrand.brandName || null,
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
    return { ok: false, code: "db_insert_failed", status: 500, message: "Failed to create render row." };
  }
  const renderId = stub.id as string;

  const job = await jobsQueue.add(
    "produce",
    {
      type: "produce",
      userId,
      safeId: productRecordingId,
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

  return {
    ok: true,
    result: { kind: "enqueued", renderId, jobId: job.id ?? newJobId, slug },
  };
}
