import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/db/supabase";
import { requireSession, sanitizePresenter } from "@/lib/apiAuth";
import { downloadRecording } from "@/lib/render/download";
import { eventsToKeyframes } from "@/lib/render/keyframes";
import { jobsQueue } from "@/lib/queue/connection";
import type { MergeJobPayload, MergeRecordingPayload } from "@/lib/queue/payloads";
import { getPresignedUrl } from "@/lib/storage/r2";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TARGET_URL, MERCHANT_TARGET_URL } from "@/app/config";
import { type WebcamSettings, DEFAULT_WEBCAM_SETTINGS } from "@/types/webcam";

export const runtime = "nodejs";

type RequestBody = {
  merchantRecordingId?: unknown;
  productRecordingId?: unknown;
  brand?: unknown;
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

  if (typeof body.merchantRecordingId !== "string" || typeof body.productRecordingId !== "string") {
    return NextResponse.json({ error: "Missing merchantRecordingId or productRecordingId." }, { status: 400 });
  }

  const merchantRecordingId = body.merchantRecordingId;
  const productRecordingId = body.productRecordingId;
  const brand = typeof body.brand === "string" ? body.brand : null;

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
    id: string; merchant_id: string | null; mouse_events_url: string;
    webcam_url: string | null; metadata: Record<string, unknown>;
  };

  // Resolve the merchant brand URL
  const merchantMeta = (merchant.metadata ?? {}) as Record<string, unknown>;
  let merchantBrandUrl = typeof merchantMeta.merchantUrl === "string" ? merchantMeta.merchantUrl : "";

  if (!merchantBrandUrl && merchant.merchant_id) {
    const { data: merchantRow } = await supabase
      .from("vlad_merchants")
      .select("url")
      .eq("id", merchant.merchant_id)
      .single();
    merchantBrandUrl = (merchantRow as { url?: string } | null)?.url ?? "";
  }

  const product = productRes.data as {
    id: string; product_name: string | null; mouse_events_url: string;
    webcam_url: string | null; metadata: Record<string, unknown>;
  };

  const presenter = sanitizePresenter(session.email);
  const jobId = randomUUID().slice(0, 8);
  const outputSessionName = `merge_${jobId}`;

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
    const productMeta = product.metadata ?? {};
    const productKeyframes = eventsToKeyframes(productRec.mouseData.events as Parameters<typeof eventsToKeyframes>[0]);
    const productDuration = productKeyframes.length > 0 ? productKeyframes[productKeyframes.length - 1].t : 1000;
    const productUrl = `${TARGET_URL}?product=${encodeURIComponent(product.product_name ?? "")}&brand=${encodeURIComponent(merchantBrandUrl)}`;
    const productSessionName = `merge_${jobId}_product`;
    const productWebcam = extractWebcamSettings(productMeta as Record<string, unknown>);

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
      trimStartSec: typeof (productMeta as Record<string, unknown>).trimStartSec === "number" ? (productMeta as Record<string, unknown>).trimStartSec as number : undefined,
      trimEndSec: typeof (productMeta as Record<string, unknown>).trimEndSec === "number" ? (productMeta as Record<string, unknown>).trimEndSec as number : undefined,
      mouseEventsR2Key: product.mouse_events_url,
      webcamR2Key: product.webcam_url,
    };

    const job = await jobsQueue.add("merge", {
      type: "merge",
      presenter,
      brand,
      outputSessionName,
      merchantRecordingId: merchant.id,
      productRecordingId: product.id,
      merchantId: merchant.merchant_id,
      productName: product.product_name,
      merchant: merchantPayload,
      product: productPayload,
    } satisfies MergeJobPayload, {
      jobId,
      priority: 5,
    });

    return NextResponse.json({ jobId: job.id });
  } finally {
    // Clean up prep temp dir (only downloaded mouse JSON for keyframe computation)
    const { rm } = await import("node:fs/promises");
    rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
  }

  const job = await jobsQueue.getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const state = await job.getState();

  if (state === "completed") {
    const raw = job.returnvalue;
    const result = (typeof raw === "string" ? JSON.parse(raw) : raw) as { videoUrl: string; renderId: string | undefined };
    const presignedUrl = await getPresignedUrl(result.videoUrl);
    return NextResponse.json({
      status: "done",
      currentStep: 4,
      stepProgress: [100, 100, 100, 100, 100],
      stepLabels: ["Rendering intro", "Compositing intro", "Rendering product", "Compositing product", "Merging"],
      videoUrl: presignedUrl,
      renderId: result.renderId,
    });
  }

  if (state === "failed") {
    return NextResponse.json({
      status: "error",
      error: job.failedReason ?? "Merge failed.",
    });
  }

  // Active or waiting — return progress
  const progress = job.progress;
  if (progress && typeof progress === "object" && "status" in (progress as Record<string, unknown>)) {
    return NextResponse.json(progress);
  }

  // Job queued but not started yet
  return NextResponse.json({
    status: "running",
    currentStep: 0,
    stepProgress: [0, 0, 0, 0, 0],
    stepLabels: ["Rendering intro", "Compositing intro", "Rendering product", "Compositing product", "Merging"],
  });
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
