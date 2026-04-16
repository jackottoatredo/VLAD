import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { supabase } from "@/lib/db/supabase";
import { requireSession, sanitizePresenter } from "@/lib/apiAuth";
import { downloadRecording } from "@/lib/render/download";
import { eventsToKeyframes } from "@/lib/render/keyframes";
import { createReplayAction } from "@/lib/render/actions";
import { produceSessionVideo } from "@/lib/render/produce";
import { mergeVideoFiles } from "@/lib/render/merge";
import { readFile } from "node:fs/promises";
import { uploadToR2 } from "@/lib/storage/r2";
import { TARGET_URL, MERCHANT_TARGET_URL, DEFAULT_FPS, VIDEO_WIDTH, VIDEO_HEIGHT, RENDER_ZOOM } from "@/app/config";

export const runtime = "nodejs";

// In-memory progress store for active merge jobs
type MergeJobState = {
  status: "running" | "done" | "error";
  /** Which pipeline step is active (0-indexed) */
  currentStep: number;
  /** Per-step progress 0-100 */
  stepProgress: number[];
  stepLabels: string[];
  videoUrl?: string;
  renderId?: string;
  error?: string;
};

const mergeJobs = new Map<string, MergeJobState>();

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

  // Resolve the merchant brand URL — prefer metadata (saved at recording time), fall back to vlad_merchants table
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

  const jobId = randomUUID().slice(0, 8);
  const stepLabels = [
    "Rendering intro",
    "Compositing intro",
    "Rendering product",
    "Compositing product",
    "Merging",
  ];

  mergeJobs.set(jobId, {
    status: "running",
    currentStep: 0,
    stepProgress: stepLabels.map(() => 0),
    stepLabels,
  });

  // Run the pipeline in the background
  runMergePipeline(jobId, merchant, product, brand, merchantBrandUrl, session.email).catch(() => {});

  return NextResponse.json({ jobId });
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

  const job = mergeJobs.get(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json(job);
}

function updateStep(jobId: string, stepIndex: number, progress: number) {
  const job = mergeJobs.get(jobId);
  if (!job) return;
  job.currentStep = stepIndex;
  job.stepProgress = [...job.stepProgress];
  job.stepProgress[stepIndex] = progress;
}

function completeStep(jobId: string, stepIndex: number) {
  updateStep(jobId, stepIndex, 100);
}

async function runMergePipeline(
  jobId: string,
  merchant: {
    id: string; merchant_id: string | null; mouse_events_url: string;
    webcam_url: string | null; metadata: Record<string, unknown>;
  },
  product: {
    id: string; product_name: string | null; mouse_events_url: string;
    webcam_url: string | null; metadata: Record<string, unknown>;
  },
  brand: string | null,
  merchantBrandUrl: string,
  userEmail: string,
) {
  const presenter = sanitizePresenter(userEmail);
  const workDir = path.join(tmpdir(), `vlad-merge-${jobId}`);
  const merchantDir = path.join(workDir, "merchant");
  const productDir = path.join(workDir, "product");
  await mkdir(merchantDir, { recursive: true });
  await mkdir(productDir, { recursive: true });

  // Output goes to a persistent renderings dir
  const outputSessionName = `merge_${jobId}`;
  const renderingsDir = path.join(process.cwd(), "public", "users", presenter, outputSessionName, "renderings");
  await mkdir(renderingsDir, { recursive: true });

  try {
    // Download both recordings from R2
    const [merchantRec, productRec] = await Promise.all([
      downloadRecording(merchant.mouse_events_url, merchant.webcam_url, merchantDir),
      downloadRecording(product.mouse_events_url, product.webcam_url, productDir),
    ]);

    // Extract webcam settings from metadata if saved
    const merchantMeta = merchant.metadata ?? {};
    const productMeta = product.metadata ?? {};

    const merchantWebcam = {
      webcamMode: (merchantMeta.webcamMode as string) ?? "off",
      webcamVertical: (merchantMeta.webcamVertical as string) ?? "bottom",
      webcamHorizontal: (merchantMeta.webcamHorizontal as string) ?? "right",
    };
    const productWebcam = {
      webcamMode: (productMeta.webcamMode as string) ?? "off",
      webcamVertical: (productMeta.webcamVertical as string) ?? "bottom",
      webcamHorizontal: (productMeta.webcamHorizontal as string) ?? "right",
    };

    const merchantTrimStart = typeof merchantMeta.trimStartSec === "number" ? merchantMeta.trimStartSec : undefined;
    const merchantTrimEnd = typeof merchantMeta.trimEndSec === "number" ? merchantMeta.trimEndSec : undefined;
    const productTrimStart = typeof productMeta.trimStartSec === "number" ? productMeta.trimStartSec : undefined;
    const productTrimEnd = typeof productMeta.trimEndSec === "number" ? productMeta.trimEndSec : undefined;

    // --- Step 0: Render intro ---
    const merchantKeyframes = eventsToKeyframes(merchantRec.mouseData.events as Parameters<typeof eventsToKeyframes>[0]);
    const merchantDuration = merchantKeyframes.length > 0 ? merchantKeyframes[merchantKeyframes.length - 1].t : 1000;
    const merchantAction = createReplayAction(merchantKeyframes, merchantDuration);

    const merchantUrl = merchantBrandUrl
      ? `${MERCHANT_TARGET_URL}?brand=${encodeURIComponent(merchantBrandUrl)}`
      : MERCHANT_TARGET_URL;
    const merchantSessionName = `merge_${jobId}_merchant`;

    // Set up local webcam for compositing — symlink or copy from downloaded file
    if (merchantRec.webcamPath) {
      const webcamDest = path.join(
        process.cwd(), "public", "users", presenter, merchantSessionName,
        "recordings", `${merchantSessionName}_webcam.webm`
      );
      await mkdir(path.dirname(webcamDest), { recursive: true });
      const { copyFile } = await import("node:fs/promises");
      await copyFile(merchantRec.webcamPath, webcamDest);
    }

    const merchantSettleHint = merchantKeyframes.length > 0 ? { x: merchantKeyframes[0].x, y: merchantKeyframes[0].y } : undefined;

    const merchantResult = await produceSessionVideo({
      url: merchantUrl,
      presenter,
      sessionName: merchantSessionName,
      width: merchantRec.mouseData.virtualWidth,
      height: merchantRec.mouseData.virtualHeight,
      videoWidth: VIDEO_WIDTH,
      videoHeight: VIDEO_HEIGHT,
      zoom: RENDER_ZOOM,
      fps: DEFAULT_FPS,
      durationMs: merchantDuration,
      actions: [merchantAction],
      settleHint: merchantSettleHint,
      onRenderProgress: (rendered, total) => {
        updateStep(jobId, 0, Math.round((rendered / total) * 100));
      },
      onRenderComplete: () => completeStep(jobId, 0),
      onComposeProgress: (s, total) => {
        updateStep(jobId, 1, Math.round((s / total) * 100));
      },
      webcamSettings: merchantWebcam as import("@/types/webcam").WebcamSettings,
      trimStartSec: merchantTrimStart,
      trimEndSec: merchantTrimEnd,
    });
    completeStep(jobId, 1);

    // --- Step 2: Render product ---
    const productKeyframes = eventsToKeyframes(productRec.mouseData.events as Parameters<typeof eventsToKeyframes>[0]);
    const productDuration = productKeyframes.length > 0 ? productKeyframes[productKeyframes.length - 1].t : 1000;
    const productAction = createReplayAction(productKeyframes, productDuration);

    // Product URL uses the merchant's brand URL for branded rendering
    const productUrl = `${TARGET_URL}?product=${encodeURIComponent(product.product_name ?? "")}&brand=${encodeURIComponent(merchantBrandUrl)}`;
    const productSessionName = `merge_${jobId}_product`;

    if (productRec.webcamPath) {
      const webcamDest = path.join(
        process.cwd(), "public", "users", presenter, productSessionName,
        "recordings", `${productSessionName}_webcam.webm`
      );
      await mkdir(path.dirname(webcamDest), { recursive: true });
      const { copyFile } = await import("node:fs/promises");
      await copyFile(productRec.webcamPath, webcamDest);
    }

    const productSettleHint = productKeyframes.length > 0 ? { x: productKeyframes[0].x, y: productKeyframes[0].y } : undefined;

    const productResult = await produceSessionVideo({
      url: productUrl,
      presenter,
      sessionName: productSessionName,
      width: productRec.mouseData.virtualWidth,
      height: productRec.mouseData.virtualHeight,
      videoWidth: VIDEO_WIDTH,
      videoHeight: VIDEO_HEIGHT,
      zoom: RENDER_ZOOM,
      fps: DEFAULT_FPS,
      durationMs: productDuration,
      actions: [productAction],
      settleHint: productSettleHint,
      onRenderProgress: (rendered, total) => {
        updateStep(jobId, 2, Math.round((rendered / total) * 100));
      },
      onRenderComplete: () => completeStep(jobId, 2),
      onComposeProgress: (s, total) => {
        updateStep(jobId, 3, Math.round((s / total) * 100));
      },
      webcamSettings: productWebcam as import("@/types/webcam").WebcamSettings,
      trimStartSec: productTrimStart,
      trimEndSec: productTrimEnd,
    });
    completeStep(jobId, 3);

    // --- Step 4: Merge ---
    // Resolve absolute paths for the final videos from both pipelines
    const publicDir = path.join(process.cwd(), "public");
    const merchantVideoPath = path.join(publicDir, merchantResult.finalUrl);
    const productVideoPath = path.join(publicDir, productResult.finalUrl);

    const { mergedPath, mergedUrl } = await mergeVideoFiles(
      merchantVideoPath,
      productVideoPath,
      renderingsDir,
      brand ?? `${merchant.merchant_id}-${product.product_name}`,
      (pct) => updateStep(jobId, 4, pct),
    );
    completeStep(jobId, 4);

    // Upload merged video to R2
    const r2Key = `users/${presenter}/${outputSessionName}/renderings/${path.basename(mergedPath)}`;
    const fileBuffer = await readFile(mergedPath);
    await uploadToR2(r2Key, fileBuffer, "video/mp4");

    // Save to DB with R2 key
    const { data: renderRow } = await supabase
      .from("vlad_renders")
      .insert({
        merchant_recording_id: merchant.id,
        product_recording_id: product.id,
        brand,
        video_url: r2Key,
        status: "done",
        progress: 100,
        seen: false,
      })
      .select("id")
      .single();

    const job = mergeJobs.get(jobId);
    if (job) {
      job.status = "done";
      job.videoUrl = r2Key;
      job.renderId = renderRow?.id;
    }
  } catch (err) {
    console.error("Merge pipeline failed:", err);
    const job = mergeJobs.get(jobId);
    if (job) {
      job.status = "error";
      job.error = err instanceof Error ? err.message : "Merge failed.";
    }
  } finally {
    // Cleanup temp download dir
    rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
