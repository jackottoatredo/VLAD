import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { shortJobId } from "@/lib/queue/jobId";
import { requireSession } from "@/lib/apiAuth";
import { downloadRecording } from "@/lib/render/download";
import { eventsToKeyframes } from "@/lib/render/keyframes";
import { jobsQueue } from "@/lib/queue/connection";
import type { MergeJobPayload, MergeRecordingPayload } from "@/lib/queue/payloads";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TARGET_URL, MERCHANT_TARGET_URL } from "@/app/config";
import { joinNameParts, slugifyPart, deriveMerchantNameFromUrl } from "@/lib/naming";
import { reserveUniqueName } from "@/lib/db/reserveName";
import {
  type RenderSpec,
  type Webcam,
  type SectionFormSettings,
  type MergeRenderSpec,
  type Transitions,
  DEFAULT_TRANSITIONS,
  DEFAULT_THROB_MIN,
  DEFAULT_THROB_MAX,
  DEFAULT_MORPH_DURATION_MS,
  DEFAULT_MOUSE_HANDOFF_MS,
  extractWebcamFromMetadata,
  resolveMergeWebcams,
  webcamEquals,
} from "@/lib/render/spec";
import { computeLastMousePos } from "@/lib/render/mouse-handoff";
import { amplitudeKeyForWebcam } from "@/lib/audio/amplitude";

export const runtime = "nodejs";

type RequestBody = {
  merchantRecordingId?: unknown;
  productRecordingId?: unknown;
  /** Full modal state — when present, drives custom settings end-to-end. */
  introSettings?: unknown;
  productSettings?: unknown;
  transition?: unknown;
  /** When false, skip the intro section (intro-only / product-only flows live here). */
  introEnabled?: unknown;
  productEnabled?: unknown;
};

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

function parseTransitions(v: unknown): Transitions {
  if (!v || typeof v !== "object") return DEFAULT_TRANSITIONS;
  const o = v as Record<string, unknown>;
  // v1: schema-only — accept the values but worker honors only 'none'.
  return {
    audio: o.audio === "crossfade" ? "crossfade" : "none",
    video: o.video === "crossfade" ? "crossfade" : "none",
    overlay: o.overlay === "animated" ? "animated" : "none",
  };
}

function buildSectionSpec(args: {
  webcam: Webcam;
  webcamR2Key: string | null;
  trimStartSec: number | undefined;
  trimEndSec: number | undefined;
  morphFrom?: Webcam;
  mouseHandoffFrom?: { x: number; y: number };
}): RenderSpec {
  const { webcam, webcamR2Key, trimStartSec, trimEndSec, morphFrom, mouseHandoffFrom } = args;
  return {
    webcam,
    morph:
      morphFrom && !webcamEquals(morphFrom, webcam)
        ? {
            fromMode: morphFrom.mode,
            fromPosition: morphFrom.position,
            durationMs: DEFAULT_MORPH_DURATION_MS,
          }
        : undefined,
    throb:
      webcam.mode === "audio" && webcamR2Key
        ? {
            enabled: true,
            amplitudeKey: amplitudeKeyForWebcam(webcamR2Key),
            minScale: DEFAULT_THROB_MIN,
            maxScale: DEFAULT_THROB_MAX,
          }
        : undefined,
    mouseHandoff: mouseHandoffFrom
      ? {
          fromX: mouseHandoffFrom.x,
          fromY: mouseHandoffFrom.y,
          durationMs: DEFAULT_MOUSE_HANDOFF_MS,
          easing: "easeInOut",
        }
      : undefined,
    trim:
      trimStartSec || trimEndSec
        ? { startSec: trimStartSec ?? 0, endSec: trimEndSec ?? 0 }
        : undefined,
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

  const introEnabled = body.introEnabled !== false; // default true
  const productEnabled = body.productEnabled !== false; // default true

  if (!introEnabled && !productEnabled) {
    return NextResponse.json({ error: "At least one section must be enabled." }, { status: 400 });
  }

  const introForm = parseSectionForm(body.introSettings);
  const productForm = parseSectionForm(body.productSettings);
  const transition = parseTransitions(body.transition);

  if (
    introEnabled &&
    (typeof body.merchantRecordingId !== "string" || !body.merchantRecordingId)
  ) {
    return NextResponse.json({ error: "Missing merchantRecordingId." }, { status: 400 });
  }
  if (
    productEnabled &&
    (typeof body.productRecordingId !== "string" || !body.productRecordingId)
  ) {
    return NextResponse.json({ error: "Missing productRecordingId." }, { status: 400 });
  }

  const merchantRecordingId = introEnabled ? (body.merchantRecordingId as string) : null;
  const productRecordingId = productEnabled ? (body.productRecordingId as string) : null;

  // Fetch enabled recordings.
  const [merchantRes, productRes] = await Promise.all([
    merchantRecordingId
      ? supabase.from("vlad_recordings").select("*").eq("id", merchantRecordingId).single()
      : Promise.resolve({ data: null, error: null } as const),
    productRecordingId
      ? supabase.from("vlad_recordings").select("*").eq("id", productRecordingId).single()
      : Promise.resolve({ data: null, error: null } as const),
  ]);

  if (introEnabled && (merchantRes.error || !merchantRes.data)) {
    return NextResponse.json({ error: "Merchant recording not found." }, { status: 404 });
  }
  if (productEnabled && (productRes.error || !productRes.data)) {
    return NextResponse.json({ error: "Product recording not found." }, { status: 404 });
  }

  const merchant = merchantRes.data as
    | {
        id: string; name: string; merchant_id: string | null; merchant_name: string | null;
        mouse_events_url: string; webcam_url: string | null; metadata: Record<string, unknown>;
      }
    | null;
  const product = productRes.data as
    | {
        id: string; name: string; product_name: string | null; mouse_events_url: string;
        webcam_url: string | null; metadata: Record<string, unknown>;
      }
    | null;

  // Resolve merchant brand metadata (URL + name) — needed for naming and the
  // merchant-render's URL parameter, plus product URL when both sections exist.
  let merchantBrandUrl = "";
  let merchantBrandName: string | null = null;
  let previewsWebsiteUrl = "";
  if (merchant) {
    const merchantMeta = (merchant.metadata ?? {}) as Record<string, unknown>;
    if (typeof merchantMeta.merchantUrl === "string") {
      merchantBrandUrl = merchantMeta.merchantUrl;
    }
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
        merchantBrandUrl = previewsWebsiteUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
      }
    }
  }

  const merchantNameSlug = merchant
    ? slugifyPart(merchant.merchant_name) ||
      slugifyPart(merchantBrandName) ||
      deriveMerchantNameFromUrl(previewsWebsiteUrl || merchantBrandUrl)
    : null;
  if (introEnabled && !merchantNameSlug) {
    return NextResponse.json({ error: "Cannot derive merchant-name for slug." }, { status: 400 });
  }

  if (product && !product.product_name) {
    return NextResponse.json({ error: "Product recording has no product_name (SKU)." }, { status: 400 });
  }

  const userId = session.email;
  const jobId = shortJobId();
  const outputSessionName = `merge_${jobId}`;

  // Naming: brand label + slug.
  let brandBase: string;
  let slugBase: string;
  if (merchant && product) {
    brandBase = joinNameParts([merchant.name, product.name]);
    slugBase = joinNameParts([merchantNameSlug!, product.product_name!]);
  } else if (merchant) {
    brandBase = merchant.name;
    slugBase = merchantNameSlug!;
  } else if (product) {
    brandBase = product.name;
    slugBase = product.product_name!;
  } else {
    return NextResponse.json({ error: "Neither section has a recording." }, { status: 400 });
  }

  const brand = await reserveUniqueName({
    table: "vlad_renders",
    column: "brand",
    userId,
    base: brandBase,
  });
  const slug = await reserveUniqueName({
    table: "vlad_renders",
    column: "slug",
    base: slugBase,
  });

  const { data: stub, error: stubErr } = await supabase
    .from("vlad_renders")
    .insert({
      user_id: userId,
      job_id: jobId,
      job_request: { endpoint: "/api/merge-export", body },
      merchant_recording_id: merchant?.id ?? null,
      product_recording_id: product?.id ?? null,
      brand,
      brand_name: merchantBrandName,
      brand_url: merchantBrandUrl || null,
      product_name: product?.product_name ?? null,
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

  // Download mouse events to compute keyframes.
  const workDir = path.join(tmpdir(), `vlad-merge-prep-${jobId}`);
  const merchantPrepDir = path.join(workDir, "merchant");
  const productPrepDir = path.join(workDir, "product");
  if (merchant) await mkdir(merchantPrepDir, { recursive: true });
  if (product) await mkdir(productPrepDir, { recursive: true });

  try {
    const [merchantRec, productRec] = await Promise.all([
      merchant
        ? downloadRecording(merchant.mouse_events_url, null, merchantPrepDir)
        : Promise.resolve(null),
      product
        ? downloadRecording(product.mouse_events_url, null, productPrepDir)
        : Promise.resolve(null),
    ]);

    // Resolve webcams using the form state with sibling cross-references.
    const introSelfWebcam = merchant ? extractWebcamFromMetadata(merchant.metadata) : undefined;
    const productSelfWebcam = product ? extractWebcamFromMetadata(product.metadata) : undefined;
    const { intro: introWebcam, product: productWebcam } = resolveMergeWebcams(
      merchant && introSelfWebcam ? { form: introForm, selfWebcam: introSelfWebcam } : null,
      product && productSelfWebcam ? { form: productForm, selfWebcam: productSelfWebcam } : null,
    );

    // Merchant payload.
    let merchantPayload: MergeRecordingPayload | null = null;
    if (merchant && merchantRec && introWebcam) {
      const merchantMeta = (merchant.metadata ?? {}) as Record<string, unknown>;
      const merchantKeyframes = eventsToKeyframes(
        merchantRec.mouseData.events as Parameters<typeof eventsToKeyframes>[0],
      );
      const merchantDuration = merchantKeyframes.length > 0
        ? merchantKeyframes[merchantKeyframes.length - 1].t
        : 1000;
      const merchantUrl = merchantBrandUrl
        ? `${MERCHANT_TARGET_URL}?brand=${encodeURIComponent(merchantBrandUrl)}`
        : MERCHANT_TARGET_URL;
      const merchantTrimStart = typeof merchantMeta.trimStartSec === "number" ? merchantMeta.trimStartSec : undefined;
      const merchantTrimEnd = typeof merchantMeta.trimEndSec === "number" ? merchantMeta.trimEndSec : undefined;

      const merchantSpec = buildSectionSpec({
        webcam: introWebcam,
        webcamR2Key: merchant.webcam_url ?? null,
        trimStartSec: merchantTrimStart,
        trimEndSec: merchantTrimEnd,
        // Intro never receives morph or handoff (it opens the merge).
      });

      merchantPayload = {
        url: merchantUrl,
        sessionName: `merge_${jobId}_merchant`,
        width: merchantRec.mouseData.virtualWidth,
        height: merchantRec.mouseData.virtualHeight,
        keyframes: merchantKeyframes,
        settleHint: merchantKeyframes.length > 0
          ? { x: merchantKeyframes[0].x, y: merchantKeyframes[0].y }
          : undefined,
        spec: merchantSpec,
        durationMs: merchantDuration,
        mouseEventsR2Key: merchant.mouse_events_url,
        webcamR2Key: merchant.webcam_url,
      };
    }

    // Product payload.
    let productPayload: MergeRecordingPayload | null = null;
    if (product && productRec && productWebcam) {
      const productMeta = (product.metadata ?? {}) as Record<string, unknown>;
      const productKeyframes = eventsToKeyframes(
        productRec.mouseData.events as Parameters<typeof eventsToKeyframes>[0],
      );
      const productDuration = productKeyframes.length > 0
        ? productKeyframes[productKeyframes.length - 1].t
        : 1000;
      const productUrl = `${TARGET_URL}?product=${encodeURIComponent(product.product_name ?? "")}&brand=${encodeURIComponent(merchantBrandUrl)}`;
      const productTrimStart = typeof productMeta.trimStartSec === "number" ? productMeta.trimStartSec : undefined;
      const productTrimEnd = typeof productMeta.trimEndSec === "number" ? productMeta.trimEndSec : undefined;

      // Compute mouse handoff: only when both sections are enabled. The
      // intro's last cursor position seeds the product's opening glide.
      let mouseHandoffFrom: { x: number; y: number } | undefined;
      if (merchantPayload && merchant) {
        const merchantMeta = (merchant.metadata ?? {}) as Record<string, unknown>;
        const merchantTS = typeof merchantMeta.trimStartSec === "number" ? merchantMeta.trimStartSec : undefined;
        const merchantTE = typeof merchantMeta.trimEndSec === "number" ? merchantMeta.trimEndSec : undefined;
        const last = computeLastMousePos(merchantPayload.keyframes, merchantTS, merchantTE);
        if (last) mouseHandoffFrom = last;
      }

      // Morph emitted only when both sections exist AND intro's resolved
      // end-state webcam ≠ product's start-state webcam.
      const morphFrom = introWebcam ?? undefined;

      const productSpec = buildSectionSpec({
        webcam: productWebcam,
        webcamR2Key: product.webcam_url ?? null,
        trimStartSec: productTrimStart,
        trimEndSec: productTrimEnd,
        morphFrom,
        mouseHandoffFrom,
      });

      productPayload = {
        url: productUrl,
        sessionName: `merge_${jobId}_product`,
        width: productRec.mouseData.virtualWidth,
        height: productRec.mouseData.virtualHeight,
        keyframes: productKeyframes,
        // When mouse handoff is in play, settle wiggles around intro's last pos
        // so the cursor doesn't jump at the start of capture.
        settleHint: mouseHandoffFrom ?? (productKeyframes.length > 0
          ? { x: productKeyframes[0].x, y: productKeyframes[0].y }
          : undefined),
        spec: productSpec,
        durationMs: productDuration,
        mouseEventsR2Key: product.mouse_events_url,
        webcamR2Key: product.webcam_url,
      };
    }

    const merge: MergeRenderSpec = {
      intro: merchantPayload?.spec,
      product: productPayload?.spec,
      transition,
    };

    const job = await jobsQueue.add("merge", {
      type: "merge",
      userId,
      renderId,
      brand,
      outputSessionName,
      merchantRecordingId: merchant?.id ?? null,
      productRecordingId: product?.id ?? null,
      merchant: merchantPayload,
      product: productPayload,
      merge,
    } satisfies MergeJobPayload, {
      jobId,
      priority: 5,
    });

    return NextResponse.json({ jobId: job.id, renderId, slug });
  } finally {
    const { rm } = await import("node:fs/promises");
    rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
