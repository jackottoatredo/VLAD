import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";
import { downloadRecording } from "@/lib/render/download";
import { eventsToKeyframes } from "@/lib/render/keyframes";
import { jobsQueue } from "@/lib/queue/connection";
import { DEFAULT_MERGE_JOB_SETTINGS, type MergeJobPayload, type MergeRecordingPayload } from "@/lib/queue/payloads";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TARGET_URL, MERCHANT_TARGET_URL } from "@/app/config";
import { type WebcamSettings, DEFAULT_WEBCAM_SETTINGS } from "@/types/webcam";
import { joinNameParts, slugifyPart, deriveMerchantNameFromUrl } from "@/lib/naming";
import { reserveUniqueName } from "@/lib/db/reserveName";

export const runtime = "nodejs";

type RequestBody = {
  merchantRecordingId?: unknown;
  productRecordingId?: unknown;
};

/**
 * Enqueue a merge (intro + product) render. Naming follows AGENTS.md spec:
 *   brand label = `{intro-name}-{product-rec-name}-{count}`     (per-user dedup)
 *   slug        = `{merchant-name}-{product-name}-{count}`      (global dedup)
 * Both reserved at enqueue time so the dashboard can show the share URL
 * immediately. Worker only fills in video_url + share assets on completion.
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

  if (typeof body.merchantRecordingId !== "string" || typeof body.productRecordingId !== "string") {
    return NextResponse.json({ error: "Missing merchantRecordingId or productRecordingId." }, { status: 400 });
  }

  const merchantRecordingId = body.merchantRecordingId;
  const productRecordingId = body.productRecordingId;

  // Fetch both recordings from DB
  const [merchantRes, productRes] = await Promise.all([
    supabase.from("vlad_recordings").select("*").eq("id", merchantRecordingId).single(),
    supabase.from("vlad_recordings").select("*").eq("id", productRecordingId).single(),
  ]);

  if (merchantRes.error || !merchantRes.data) {
    return NextResponse.json({ error: "Merchant recording not found." }, { status: 404 });
  }
  if (productRes.error || !productRes.data) {
    return NextResponse.json({ error: "Product recording not found." }, { status: 404 });
  }

  const merchant = merchantRes.data as {
    id: string; name: string; merchant_id: string | null; merchant_name: string | null;
    mouse_events_url: string; webcam_url: string | null; metadata: Record<string, unknown>;
  };

  // Resolve the merchant brand URL + display name. previews.data.brandName is
  // the human-readable form ("And Collar"); the URL host is the slug-y form
  // ("and-collar.com"). Old recordings stored merchantUrl in their own metadata
  // but never the brand name, so we always hit previews when merchant_id is set.
  const merchantMeta = (merchant.metadata ?? {}) as Record<string, unknown>;
  let merchantBrandUrl = typeof merchantMeta.merchantUrl === "string" ? merchantMeta.merchantUrl : "";
  let merchantBrandName: string | null = null;
  let previewsWebsiteUrl = "";

  if (merchant.merchant_id) {
    const { data: previewRow } = await supabase
      .from("previews")
      .select("website_url, data")
      .eq("id", merchant.merchant_id)
      .maybeSingle();
    const pRow = previewRow as { website_url?: string; data?: { brandName?: string } | null } | null;
    if (typeof pRow?.data?.brandName === "string" && pRow.data.brandName) {
      merchantBrandName = pRow.data.brandName;
    }
    if (typeof pRow?.website_url === "string") {
      previewsWebsiteUrl = pRow.website_url;
    }
    if (!merchantBrandUrl) {
      // The iframe brand target rejects URLs with http(s):// — strip before using.
      merchantBrandUrl = previewsWebsiteUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    }
  }

  // Canonical merchant-name slug. Prefer the persisted column (set by
  // save-recording on new rows), fall back to live previews lookup, then to
  // the cleaned URL. No fallback to merchant_id (no internal IDs in slugs).
  const merchantNameSlug =
    slugifyPart(merchant.merchant_name) ||
    slugifyPart(merchantBrandName) ||
    deriveMerchantNameFromUrl(previewsWebsiteUrl || merchantBrandUrl);
  if (!merchantNameSlug) {
    return NextResponse.json({ error: "Cannot derive merchant-name for slug." }, { status: 400 });
  }

  const product = productRes.data as {
    id: string; name: string; product_name: string | null; mouse_events_url: string;
    webcam_url: string | null; metadata: Record<string, unknown>;
  };
  if (!product.product_name) {
    return NextResponse.json({ error: "Product recording has no product_name (SKU)." }, { status: 400 });
  }
  if (!product.name || !merchant.name) {
    return NextResponse.json({ error: "Source recordings must have names." }, { status: 400 });
  }

  const userId = session.email;
  const jobId = randomUUID().slice(0, 8);
  const outputSessionName = `merge_${jobId}`;

  // brand label (per-user dedup): `{intro-name}-{product-rec-name}-{count}`
  const brandBase = joinNameParts([merchant.name, product.name]);
  const brand = await reserveUniqueName({
    table: "vlad_renders",
    column: "brand",
    userId,
    base: brandBase,
  });

  // slug (global dedup): `{merchant-name}-{product-name}-{count}`
  const slugBase = joinNameParts([merchantNameSlug, product.product_name]);
  const slug = await reserveUniqueName({
    table: "vlad_renders",
    column: "slug",
    base: slugBase,
  });

  // Stub the vlad_renders row at job-enqueue time. The UI hydrates this on
  // mount so an in-progress render survives page reloads — without the stub,
  // refresh wipes the only client-side reference to the job. The worker
  // UPDATEs this same row when the job completes (status='done', video_url,
  // share assets). On failure, worker.on('failed') marks status='error'.
  const { data: stub, error: stubErr } = await supabase
    .from("vlad_renders")
    .insert({
      user_id: userId,
      job_id: jobId,
      job_request: { endpoint: "/api/merge-export", body },
      merchant_recording_id: merchant.id,
      product_recording_id: product.id,
      brand,
      brand_name: merchantBrandName,
      brand_url: merchantBrandUrl || null,
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

  // Download recordings from R2 to compute keyframes for the payload
  const workDir = path.join(tmpdir(), `vlad-merge-prep-${jobId}`);
  const merchantPrepDir = path.join(workDir, "merchant");
  const productPrepDir = path.join(workDir, "product");
  await mkdir(merchantPrepDir, { recursive: true });
  await mkdir(productPrepDir, { recursive: true });

  try {
    const [merchantRec, productRec] = await Promise.all([
      downloadRecording(merchant.mouse_events_url, null, merchantPrepDir),
      downloadRecording(product.mouse_events_url, null, productPrepDir),
    ]);

    // Prepare merchant payload
    const merchantKeyframes = eventsToKeyframes(merchantRec.mouseData.events as Parameters<typeof eventsToKeyframes>[0]);
    const merchantDuration = merchantKeyframes.length > 0 ? merchantKeyframes[merchantKeyframes.length - 1].t : 1000;
    const merchantUrl = merchantBrandUrl
      ? `${MERCHANT_TARGET_URL}?brand=${encodeURIComponent(merchantBrandUrl)}`
      : MERCHANT_TARGET_URL;
    const merchantSessionName = `merge_${jobId}_merchant`;
    const merchantWebcam = extractWebcamSettings(merchantMeta);

    // Prepare product payload
    const productMeta = (product.metadata ?? {}) as Record<string, unknown>;
    const productKeyframes = eventsToKeyframes(productRec.mouseData.events as Parameters<typeof eventsToKeyframes>[0]);
    const productDuration = productKeyframes.length > 0 ? productKeyframes[productKeyframes.length - 1].t : 1000;
    const productUrl = `${TARGET_URL}?product=${encodeURIComponent(product.product_name ?? "")}&brand=${encodeURIComponent(merchantBrandUrl)}`;
    const productSessionName = `merge_${jobId}_product`;
    const productWebcam = extractWebcamSettings(productMeta);

    const merchantPayload: MergeRecordingPayload = {
      url: merchantUrl,
      sessionName: merchantSessionName,
      width: merchantRec.mouseData.virtualWidth,
      height: merchantRec.mouseData.virtualHeight,
      keyframes: merchantKeyframes,
      settleHint: merchantKeyframes.length > 0 ? { x: merchantKeyframes[0].x, y: merchantKeyframes[0].y } : undefined,
      webcamSettings: merchantWebcam,
      durationMs: merchantDuration,
      trimStartSec: typeof merchantMeta.trimStartSec === "number" ? merchantMeta.trimStartSec : undefined,
      trimEndSec: typeof merchantMeta.trimEndSec === "number" ? merchantMeta.trimEndSec : undefined,
      mouseEventsR2Key: merchant.mouse_events_url,
      webcamR2Key: merchant.webcam_url,
    };

    const productPayload: MergeRecordingPayload = {
      url: productUrl,
      sessionName: productSessionName,
      width: productRec.mouseData.virtualWidth,
      height: productRec.mouseData.virtualHeight,
      keyframes: productKeyframes,
      settleHint: productKeyframes.length > 0 ? { x: productKeyframes[0].x, y: productKeyframes[0].y } : undefined,
      webcamSettings: productWebcam,
      durationMs: productDuration,
      trimStartSec: typeof productMeta.trimStartSec === "number" ? productMeta.trimStartSec : undefined,
      trimEndSec: typeof productMeta.trimEndSec === "number" ? productMeta.trimEndSec : undefined,
      mouseEventsR2Key: product.mouse_events_url,
      webcamR2Key: product.webcam_url,
    };

    const job = await jobsQueue.add("merge", {
      type: "merge",
      userId,
      renderId,
      brand,
      outputSessionName,
      merchantRecordingId: merchant.id,
      productRecordingId: product.id,
      merchant: merchantPayload,
      product: productPayload,
      settings: { ...DEFAULT_MERGE_JOB_SETTINGS },
    } satisfies MergeJobPayload, {
      jobId,
      priority: 5,
    });

    return NextResponse.json({ jobId: job.id, renderId, slug });
  } finally {
    // Clean up prep temp dir (only downloaded mouse JSON for keyframe computation)
    const { rm } = await import("node:fs/promises");
    rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
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
