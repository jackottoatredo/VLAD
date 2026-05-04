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
  type MouseTransitionStyle,
  type MouseGlideShape,
  DEFAULT_TRANSITIONS,
  DEFAULT_THROB_MIN,
  DEFAULT_THROB_MAX,
  extractWebcamFromMetadata,
  resolveMergeWebcams,
  resolveGlideShape,
  webcamEquals,
  snapTransitionDurationMs,
} from "@/lib/render/spec";
import { computeLastMousePos, computeMousePosAtExitStart } from "@/lib/render/mouse-handoff";
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
  const validMouseStyles: MouseTransitionStyle[] = ["none", "linear", "arched", "natural"];
  const mouse: MouseTransitionStyle =
    typeof o.mouse === "string" && (validMouseStyles as string[]).includes(o.mouse)
      ? (o.mouse as MouseTransitionStyle)
      : "none";
  return {
    audio: o.audio === "crossfade" ? "crossfade" : "none",
    video: o.video === "crossfade" ? "crossfade" : "none",
    overlay: o.overlay === "animated" ? "animated" : "none",
    mouse,
    side: o.side === "end-of-intro" ? "end-of-intro" : "start-of-product",
    durationMs: snapTransitionDurationMs(o.durationMs),
  };
}

type SectionSpecArgs = {
  webcam: Webcam;
  webcamR2Key: string | null;
  trimStartSec: number | undefined;
  trimEndSec: number | undefined;
  /** Entry morph source (only when overlay='animated' and side='start-of-product'). */
  entryMorphFrom?: Webcam;
  /** Exit morph target (only when overlay='animated' and side='end-of-intro'). */
  exitMorphTo?: Webcam;
  /** Entry mouse glide source (only when mouse !== 'none' and entry side). */
  entryMouseFrom?: { x: number; y: number };
  /** Exit mouse glide target (only when mouse !== 'none' and exit side). */
  exitMouseTo?: { x: number; y: number };
  /** Optional explicit exit-glide source (crossfade path passes the same
   *  point as the sibling's entry handoff so paths align exactly). */
  exitMouseFrom?: { x: number; y: number };
  /** Shared duration for whichever morph/glide above is set. */
  transitionDurationMs?: number;
  /** Resolved glide shape (arc + stutter knobs). Required when any mouse
   *  glide is active; ignored otherwise. */
  glideShape?: MouseGlideShape;
};

function buildSectionSpec(args: SectionSpecArgs): RenderSpec {
  const {
    webcam,
    webcamR2Key,
    trimStartSec,
    trimEndSec,
    entryMorphFrom,
    exitMorphTo,
    entryMouseFrom,
    exitMouseTo,
    exitMouseFrom,
    transitionDurationMs,
    glideShape,
  } = args;
  const dur = transitionDurationMs ?? 400;
  // Fall back to a no-op shape (straight, no stutter) if a glide is requested
  // but no shape was supplied — defensive; the caller normally provides both.
  const shape: MouseGlideShape = glideShape ?? {
    arcFraction: 0,
    stutterAmplitude: 0,
    stutterFrequency: 0,
  };
  return {
    webcam,
    morph:
      entryMorphFrom && !webcamEquals(entryMorphFrom, webcam)
        ? {
            fromMode: entryMorphFrom.mode,
            fromPosition: entryMorphFrom.position,
            durationMs: dur,
          }
        : undefined,
    exitMorph:
      exitMorphTo && !webcamEquals(webcam, exitMorphTo)
        ? {
            toMode: exitMorphTo.mode,
            toPosition: exitMorphTo.position,
            durationMs: dur,
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
    mouseHandoff: entryMouseFrom
      ? {
          fromX: entryMouseFrom.x,
          fromY: entryMouseFrom.y,
          durationMs: dur,
          easing: "cubicEaseInOut",
          shape,
        }
      : undefined,
    exitMouseGlide: exitMouseTo
      ? {
          // Explicit fromX/fromY only when caller supplied one (crossfade path).
          // Otherwise the renderer captures from the recorded cursor at the
          // exit-start frame.
          ...(exitMouseFrom
            ? { fromX: exitMouseFrom.x, fromY: exitMouseFrom.y }
            : {}),
          toX: exitMouseTo.x,
          toY: exitMouseTo.y,
          durationMs: dur,
          easing: "cubicEaseInOut",
          shape,
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

    const dualSection = !!(merchant && product);
    const overlayAnimated = dualSection && transition.overlay === "animated";
    // Resolve the mouse-style enum into glide-shape numbers (or null for 'none').
    const glideShape = dualSection ? resolveGlideShape(transition.mouse) : null;
    const mouseAnimated = !!glideShape;
    const sideEndOfIntro = transition.side === "end-of-intro";
    const sideStartOfProduct = transition.side === "start-of-product";
    // When any crossfade is on, the xfade window simultaneously shows the
    // last N frames of intro and first N frames of product. To keep cursor
    // motion smooth across that overlap, BOTH sections must trace the same
    // glide path — so we wire entry+exit glides regardless of `side`.
    const hasCrossfade =
      dualSection && (transition.audio === "crossfade" || transition.video === "crossfade");

    // Pre-compute keyframes for both sections so we can derive the cross-
    // section mouse handoff endpoints before building either spec.
    const merchantKeyframes = merchantRec
      ? eventsToKeyframes(merchantRec.mouseData.events as Parameters<typeof eventsToKeyframes>[0])
      : [];
    const productKeyframes = productRec
      ? eventsToKeyframes(productRec.mouseData.events as Parameters<typeof eventsToKeyframes>[0])
      : [];

    // Mouse anchor points across the boundary.
    // - introLastMousePos: cursor at intro's natural END (used for concat path).
    // - introExitStartPos: cursor at intro's exit-window start
    //   (= sessionEnd - transition.durationMs). Used for crossfade path so
    //   both glides start from the same point and trace identical curves.
    let introLastMousePos: { x: number; y: number } | undefined;
    let introExitStartPos: { x: number; y: number } | undefined;
    if (merchant && merchantKeyframes.length > 0) {
      const meta = (merchant.metadata ?? {}) as Record<string, unknown>;
      const ts = typeof meta.trimStartSec === "number" ? meta.trimStartSec : undefined;
      const te = typeof meta.trimEndSec === "number" ? meta.trimEndSec : undefined;
      const last = computeLastMousePos(merchantKeyframes, ts, te);
      if (last) introLastMousePos = last;
      const exitStart = computeMousePosAtExitStart(merchantKeyframes, ts, te, transition.durationMs);
      if (exitStart) introExitStartPos = exitStart;
    }
    const productFirstMousePos =
      productKeyframes.length > 0
        ? { x: productKeyframes[0].x, y: productKeyframes[0].y }
        : undefined;

    // Merchant payload.
    let merchantPayload: MergeRecordingPayload | null = null;
    if (merchant && merchantRec && introWebcam) {
      const merchantMeta = (merchant.metadata ?? {}) as Record<string, unknown>;
      const merchantDuration = merchantKeyframes.length > 0
        ? merchantKeyframes[merchantKeyframes.length - 1].t
        : 1000;
      const merchantUrl = merchantBrandUrl
        ? `${MERCHANT_TARGET_URL}?brand=${encodeURIComponent(merchantBrandUrl)}`
        : MERCHANT_TARGET_URL;
      const merchantTrimStart = typeof merchantMeta.trimStartSec === "number" ? merchantMeta.trimStartSec : undefined;
      const merchantTrimEnd = typeof merchantMeta.trimEndSec === "number" ? merchantMeta.trimEndSec : undefined;

      // Intro carries exit transitions when side='end-of-intro' (concat path)
      // OR whenever crossfade is enabled with the relevant transition. This
      // keeps the xfade overlap visually coherent — both halves animate.
      const introExitMorphActive =
        overlayAnimated && (sideEndOfIntro || hasCrossfade);
      const introExitMouseActive =
        mouseAnimated && (sideEndOfIntro || hasCrossfade);

      const merchantSpec = buildSectionSpec({
        webcam: introWebcam,
        webcamR2Key: merchant.webcam_url ?? null,
        trimStartSec: merchantTrimStart,
        trimEndSec: merchantTrimEnd,
        exitMorphTo: introExitMorphActive ? productWebcam : undefined,
        exitMouseTo:
          introExitMouseActive && productFirstMousePos ? productFirstMousePos : undefined,
        // Crossfade path: pin the from to the same point product uses for
        // its entry handoff. Concat path leaves it undefined so the renderer
        // anchors at intro's recorded cursor at exit-start.
        exitMouseFrom:
          introExitMouseActive && hasCrossfade ? introExitStartPos : undefined,
        transitionDurationMs: transition.durationMs,
        glideShape: glideShape ?? undefined,
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
      const productDuration = productKeyframes.length > 0
        ? productKeyframes[productKeyframes.length - 1].t
        : 1000;
      const productUrl = `${TARGET_URL}?product=${encodeURIComponent(product.product_name ?? "")}&brand=${encodeURIComponent(merchantBrandUrl)}`;
      const productTrimStart = typeof productMeta.trimStartSec === "number" ? productMeta.trimStartSec : undefined;
      const productTrimEnd = typeof productMeta.trimEndSec === "number" ? productMeta.trimEndSec : undefined;

      // Product carries entry transitions when side='start-of-product'
      // (concat path) OR whenever crossfade is enabled with the relevant
      // transition. In the crossfade case, the entry-glide source must be
      // intro's cursor at exit-window start (NOT intro's natural last pos)
      // so that both halves' glides trace the same curve through the xfade
      // overlap. In the concat case the source is intro's natural last pos.
      const productEntryMorphActive =
        overlayAnimated && (sideStartOfProduct || hasCrossfade);
      const productEntryMouseActive =
        mouseAnimated && (sideStartOfProduct || hasCrossfade);

      const entryMorphFrom = productEntryMorphActive ? introWebcam : undefined;
      const entryMouseSource = hasCrossfade ? introExitStartPos : introLastMousePos;
      const entryMouseFrom =
        productEntryMouseActive && entryMouseSource ? entryMouseSource : undefined;

      const productSpec = buildSectionSpec({
        webcam: productWebcam,
        webcamR2Key: product.webcam_url ?? null,
        trimStartSec: productTrimStart,
        trimEndSec: productTrimEnd,
        entryMorphFrom,
        entryMouseFrom,
        transitionDurationMs: transition.durationMs,
        glideShape: glideShape ?? undefined,
      });

      productPayload = {
        url: productUrl,
        sessionName: `merge_${jobId}_product`,
        width: productRec.mouseData.virtualWidth,
        height: productRec.mouseData.virtualHeight,
        keyframes: productKeyframes,
        // When mouse handoff is in play, settle wiggles around intro's last pos
        // so the cursor doesn't jump at the start of capture.
        settleHint: entryMouseFrom ?? (productKeyframes.length > 0
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
