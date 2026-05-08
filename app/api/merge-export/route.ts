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
import {
  computeMousePosAtExitStart,
  computeMousePosAtTime,
} from "@/lib/render/mouse-handoff";
import { cursorRestPosition } from "@/lib/render/cursor-track";
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
  /** Admin-only: render on behalf of another user. Ignored for non-admin
   *  callers — they always render as themselves. Used by the admin
   *  recordings tool's edit flow so re-renders stay owned by the original
   *  user rather than transferring to the admin. */
  targetUserId?: unknown;
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

  // Snap each duration to its grid. No cross-transition constraint anymore —
  // the symmetric model lets each transition be independently sized.
  const audioDurationMs = snapTransitionDurationMs(o.audioDurationMs, 200);
  const videoDurationMs = snapTransitionDurationMs(o.videoDurationMs, 400);
  const overlayDurationMs = snapTransitionDurationMs(o.overlayDurationMs, 400);
  const mouseDurationMs = snapTransitionDurationMs(o.mouseDurationMs, 400);

  return {
    audio: o.audio === "crossfade" ? "crossfade" : "none",
    video: o.video === "crossfade" ? "crossfade" : "none",
    overlay:
      o.overlay === "animated" ? "animated" : o.overlay === "crossfade" ? "crossfade" : "none",
    mouse,
    audioDurationMs,
    videoDurationMs,
    overlayDurationMs,
    mouseDurationMs,
  };
}

type SectionSpecArgs = {
  webcam: Webcam;
  webcamR2Key: string | null;
  trimStartSec: number | undefined;
  trimEndSec: number | undefined;
  /** Entry morph source (only when overlay='animated' on the product side). */
  entryMorphFrom?: Webcam;
  /** Exit morph target (only when overlay='animated' on the intro side). */
  exitMorphTo?: Webcam;
  /** Glide-in target — when set, the cursor enters the trim window from
   *  this point (MIDPOINT in the symmetric merge model). Used on product
   *  section. */
  glideInPoint?: { x: number; y: number };
  /** Glide-out source — when set, the cursor exits the trim window toward
   *  this point (MIDPOINT in the symmetric merge model). Used on intro
   *  section. */
  glideOutPoint?: { x: number; y: number };
  /** Duration of the overlay morph (entry or exit). Sourced from
   *  Transitions.overlayDurationMs. */
  overlayDurationMs?: number;
  /** Duration of the mouse glide. Sourced from Transitions.mouseDurationMs.
   *  Each side does D/2; this is THAT half value. */
  mouseDurationMs?: number;
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
    glideInPoint,
    glideOutPoint,
    overlayDurationMs,
    mouseDurationMs,
    glideShape,
  } = args;
  const overlayDur = overlayDurationMs ?? 400;
  const mouseDur = mouseDurationMs ?? 400;
  // Fall back to a no-op shape (straight, no stutter) if a glide is requested
  // but no shape was supplied — defensive; the caller normally provides both.
  const shape: MouseGlideShape = glideShape ?? {
    arcFraction: 0,
    stutterAmplitude: 0,
    stutterFrequency: 0,
  };
  const mouseTrack =
    glideInPoint || glideOutPoint
      ? {
          glideIn: glideInPoint
            ? {
                point: glideInPoint,
                durationMs: mouseDur,
                easing: "cubicEaseInOut" as const,
                shape,
              }
            : undefined,
          glideOut: glideOutPoint
            ? {
                point: glideOutPoint,
                durationMs: mouseDur,
                easing: "cubicEaseInOut" as const,
                shape,
              }
            : undefined,
        }
      : undefined;
  return {
    webcam,
    morph:
      entryMorphFrom && !webcamEquals(entryMorphFrom, webcam)
        ? {
            fromMode: entryMorphFrom.mode,
            fromPosition: entryMorphFrom.position,
            durationMs: overlayDur,
          }
        : undefined,
    exitMorph:
      exitMorphTo && !webcamEquals(webcam, exitMorphTo)
        ? {
            toMode: exitMorphTo.mode,
            toPosition: exitMorphTo.position,
            durationMs: overlayDur,
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
    mouseTrack,
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
  console.log(
    "[merge-route] raw body.transition:",
    JSON.stringify(body.transition),
  );
  console.log(
    "[merge-route] parsed transition:",
    JSON.stringify(transition),
  );

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

  // Admin override: when the caller is an admin and a targetUserId is
  // provided, attribute the new render to that user. Silently ignored for
  // non-admins so a stray field can't escalate.
  const userId =
    session.role === "admin" && typeof body.targetUserId === "string" && body.targetUserId
      ? body.targetUserId
      : session.email;
  const jobId = shortJobId();

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
    // v6: overlay morph is now driven at the merge stage by the unified
    // overlay pass. Per-section morph specs are no longer emitted in the
    // dual-section payloads. The transition.overlay flag flows through
    // unchanged — read by the worker to set morphDurationMs.
    void dualSection; void transition; // (intentionally unused here)
    // Resolve the mouse-style enum into glide-shape numbers (or null for 'none').
    const glideShape = dualSection ? resolveGlideShape(transition.mouse) : null;
    const mouseAnimated = !!glideShape;

    // Pre-compute keyframes for both sections so we can derive the cross-
    // section mouse handoff endpoints before building either spec.
    const merchantKeyframes = merchantRec
      ? eventsToKeyframes(merchantRec.mouseData.events as Parameters<typeof eventsToKeyframes>[0])
      : [];
    const productKeyframes = productRec
      ? eventsToKeyframes(productRec.mouseData.events as Parameters<typeof eventsToKeyframes>[0])
      : [];

    // -----------------------------------------------------------------------
    // Symmetric transition model.
    //
    // Total output length = T_intro_trimmed + T_product_trimmed (always).
    // Each transition is centered on the boundary — D/2 of effect from each
    // side, sourced according to the kind:
    //   - audio:   borrowed from un-trimmed webcam.webm (D/2 each side); if
    //              insufficient, D is clamped to available.
    //   - video:   padded via FFmpeg `tpad` (clone first/last frame); always
    //              available, no borrow.
    //   - mouse:   intro exits A → MIDPOINT in last D/2 of trim window;
    //              product enters MIDPOINT → B in first D/2 of trim window.
    //   - overlay: deferred — both sides emit a morph at full D anchored to
    //              their trim-window edges (approximate, not perfectly
    //              centered on the boundary).
    //
    // Original trim values flow through to spec.trim unchanged — no
    // extension at the route layer.
    // -----------------------------------------------------------------------

    // Recording duration drives the trim/un-trimmed-audio math. Take it
    // from `mouseData.durationMs` (the recorded session length) rather than
    // the last mouse keyframe — the cursor often stops moving well before
    // the audio/video does, and using the last keyframe under-reports
    // available un-trimmed content (and even goes negative when trim
    // values extend past the last keyframe).
    const merchantSessionEndMs = merchantRec
      ? typeof merchantRec.mouseData.durationMs === "number" && merchantRec.mouseData.durationMs > 0
        ? merchantRec.mouseData.durationMs
        : merchantKeyframes.length > 0
          ? merchantKeyframes[merchantKeyframes.length - 1].t
          : 0
      : 0;
    const productSessionEndMs = productRec
      ? typeof productRec.mouseData.durationMs === "number" && productRec.mouseData.durationMs > 0
        ? productRec.mouseData.durationMs
        : productKeyframes.length > 0
          ? productKeyframes[productKeyframes.length - 1].t
          : 0
      : 0;

    const merchantMeta = (merchant?.metadata ?? {}) as Record<string, unknown>;
    const productMeta = (product?.metadata ?? {}) as Record<string, unknown>;

    // Original trim values from metadata (sec). Undefined → no trim on that edge.
    const introTrimStartSec =
      typeof merchantMeta.trimStartSec === "number" ? merchantMeta.trimStartSec : undefined;
    const introTrimEndSec =
      typeof merchantMeta.trimEndSec === "number" ? merchantMeta.trimEndSec : undefined;
    const productTrimStartSec =
      typeof productMeta.trimStartSec === "number" ? productMeta.trimStartSec : undefined;
    const productTrimEndSec =
      typeof productMeta.trimEndSec === "number" ? productMeta.trimEndSec : undefined;

    // Effective trimmed durations (ms) — sessionEnd if no trim end set.
    const introTrimmedMs = merchant
      ? (introTrimEndSec != null && introTrimEndSec > 0
          ? Math.min(introTrimEndSec * 1000, merchantSessionEndMs)
          : merchantSessionEndMs) -
        (introTrimStartSec != null && introTrimStartSec > 0 ? introTrimStartSec * 1000 : 0)
      : 0;
    const productTrimmedMs = product
      ? (productTrimEndSec != null && productTrimEndSec > 0
          ? Math.min(productTrimEndSec * 1000, productSessionEndMs)
          : productSessionEndMs) -
        (productTrimStartSec != null && productTrimStartSec > 0 ? productTrimStartSec * 1000 : 0)
      : 0;

    // Un-trimmed audio available beyond each trim boundary (ms). 0 when no
    // trim is set on that edge.
    const introPostTrimAvailableMs = merchant && introTrimEndSec != null && introTrimEndSec > 0
      ? Math.max(0, merchantSessionEndMs - introTrimEndSec * 1000)
      : 0;
    const productPreTrimAvailableMs = product && productTrimStartSec != null && productTrimStartSec > 0
      ? Math.max(0, productTrimStartSec * 1000)
      : 0;

    // Per-transition duration clamps. Each kind is independent:
    //   - All transitions: D ≤ min(intro_trimmed, product_trimmed) so D/2
    //     fits on each side of the boundary.
    //   - Audio additionally: D ≤ 2 × min(introPostTrim, productPreTrim) —
    //     the audio crossfade is sourced by borrowing D/2 of un-trimmed
    //     audio from each side; if either side has no un-trimmed audio,
    //     the audio crossfade collapses.
    const minTrimmedMs = dualSection ? Math.min(introTrimmedMs, productTrimmedMs) : Infinity;
    const audioBorrowMaxMs = dualSection
      ? 2 * Math.min(introPostTrimAvailableMs, productPreTrimAvailableMs)
      : Infinity;

    const clampDuration = (val: number, max: number): number =>
      Math.max(0, Math.floor(Math.min(val, max)));

    const effMouseDurationMs = clampDuration(transition.mouseDurationMs, minTrimmedMs);
    const effOverlayDurationMs = clampDuration(transition.overlayDurationMs, minTrimmedMs);
    const effVideoDurationMs = clampDuration(transition.videoDurationMs, minTrimmedMs);
    const effAudioDurationMs = clampDuration(
      transition.audioDurationMs,
      Math.min(minTrimmedMs, audioBorrowMaxMs),
    );

    // Drop crossfade for any kind whose clamped duration falls below the
    // usable minimum — `acrossfade` and `xfade` produce artifacts at tiny
    // windows.
    const MIN_CROSSFADE_MS = 100;
    const effAudio: "none" | "crossfade" =
      dualSection && transition.audio === "crossfade" && effAudioDurationMs >= MIN_CROSSFADE_MS
        ? "crossfade"
        : "none";
    const effVideo: "none" | "crossfade" =
      dualSection && transition.video === "crossfade" && effVideoDurationMs >= MIN_CROSSFADE_MS
        ? "crossfade"
        : "none";

    console.log(
      "[merge-route] clamp inputs:",
      JSON.stringify({
        dualSection,
        introTrimStartSec,
        introTrimEndSec,
        productTrimStartSec,
        productTrimEndSec,
        merchantSessionEndMs,
        productSessionEndMs,
        introTrimmedMs,
        productTrimmedMs,
        introPostTrimAvailableMs,
        productPreTrimAvailableMs,
        minTrimmedMs: minTrimmedMs === Infinity ? "Infinity" : minTrimmedMs,
        audioBorrowMaxMs: audioBorrowMaxMs === Infinity ? "Infinity" : audioBorrowMaxMs,
      }),
    );
    console.log(
      "[merge-route] clamp outputs:",
      JSON.stringify({
        requestedAudio: transition.audio,
        requestedAudioDurationMs: transition.audioDurationMs,
        effAudio,
        effAudioDurationMs,
        requestedVideo: transition.video,
        requestedVideoDurationMs: transition.videoDurationMs,
        effVideo,
        effVideoDurationMs,
      }),
    );

    // Symmetric mouse-glide midpoint. A = intro cursor at trim_end − D/2;
    // B = product cursor at trim_start; the cursor traces A → MIDPOINT
    // (intro's glideOut) and MIDPOINT → B (product's glideIn). The route
    // only needs MIDPOINT — the recorded-cursor anchors at each trim edge
    // are computed inside cursor-track.ts at compose time.
    // Symmetric mouse-glide midpoint. A = intro cursor at trim_end − D/2;
    // B = product cursor at trim_start. Either side may be empty (no
    // recorded movement) — in that case it falls back to the cursor's
    // resting position so the glide still has a real anchor at the
    // boundary instead of skipping entirely.
    let mouseGlideMidpoint: { x: number; y: number } | undefined;
    if (mouseAnimated && effMouseDurationMs > 0 && merchant && product && merchantRec && productRec) {
      const halfMouseMs = effMouseDurationMs / 2;
      const introRest = cursorRestPosition(
        merchantRec.mouseData.virtualWidth,
        merchantRec.mouseData.virtualHeight,
      );
      const productRest = cursorRestPosition(
        productRec.mouseData.virtualWidth,
        productRec.mouseData.virtualHeight,
      );

      const A =
        merchantKeyframes.length > 0
          ? computeMousePosAtExitStart(
              merchantKeyframes,
              introTrimStartSec,
              introTrimEndSec,
              halfMouseMs,
            ) ?? introRest
          : introRest;
      const productStartMs = productTrimStartSec != null && productTrimStartSec > 0
        ? productTrimStartSec * 1000
        : 0;
      const B =
        productKeyframes.length > 0
          ? computeMousePosAtTime(productKeyframes, productStartMs) ?? productRest
          : productRest;

      mouseGlideMidpoint = {
        x: Math.round((A.x + B.x) / 2),
        y: Math.round((A.y + B.y) / 2),
      };

      console.log(
        "[merge-route] mouse glide computation:",
        JSON.stringify({
          mouseAnimated,
          effMouseDurationMs,
          merchantKeyframesCount: merchantKeyframes.length,
          productKeyframesCount: productKeyframes.length,
          transitionMouse: transition.mouse,
          halfMouseMs,
          A,
          B,
          midpoint: mouseGlideMidpoint,
          introUsedRestFallback: merchantKeyframes.length === 0,
          productUsedRestFallback: productKeyframes.length === 0,
        }),
      );
    } else {
      console.log(
        "[merge-route] mouse glide SKIPPED — conditions failed:",
        JSON.stringify({
          mouseAnimated,
          effMouseDurationMs,
          transitionMouse: transition.mouse,
          dualSection: !!(merchant && product),
        }),
        "(transition.mouse must be linear/arched/natural; effMouseDurationMs > 0; dualSection)",
      );
    }

    // Merchant payload.
    let merchantPayload: MergeRecordingPayload | null = null;
    if (merchant && merchantRec && introWebcam) {
      const merchantDuration = typeof merchantRec.mouseData.durationMs === "number" && merchantRec.mouseData.durationMs > 0
        ? merchantRec.mouseData.durationMs
        : merchantKeyframes.length > 0
          ? merchantKeyframes[merchantKeyframes.length - 1].t
          : 1000;
      const merchantUrl = merchantBrandUrl
        ? `${MERCHANT_TARGET_URL}?brand=${encodeURIComponent(merchantBrandUrl)}`
        : MERCHANT_TARGET_URL;

      // Symmetric model: intro emits glideOut → MIDPOINT in the last D/2
      // of its trim window. The "from" anchor (cursor at trim_end − D/2)
      // is auto-computed inside cursor-track.ts, so the route only passes
      // the boundary point.
      const introExitMouseActive = mouseAnimated && !!mouseGlideMidpoint;

      // v6: NO exitMorphTo on dual-section payloads. The morph happens at
      // the merge stage in the unified overlay pass (renderUnifiedMergeOverlay)
      // — driven by intro/product webcam directly from spec.webcam, not by
      // a per-section morph. Per-section morph fields (spec.morph,
      // spec.exitMorph) are unused in the dual-section worker path.
      const merchantSpec = buildSectionSpec({
        webcam: introWebcam,
        webcamR2Key: merchant.webcam_url ?? null,
        trimStartSec: introTrimStartSec,
        trimEndSec: introTrimEndSec,
        glideOutPoint: introExitMouseActive ? mouseGlideMidpoint : undefined,
        overlayDurationMs: effOverlayDurationMs,
        mouseDurationMs: Math.floor(effMouseDurationMs / 2),
        glideShape: glideShape ?? undefined,
      });

      merchantPayload = {
        url: merchantUrl,
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
      const productDuration = typeof productRec.mouseData.durationMs === "number" && productRec.mouseData.durationMs > 0
        ? productRec.mouseData.durationMs
        : productKeyframes.length > 0
          ? productKeyframes[productKeyframes.length - 1].t
          : 1000;
      const productUrl = `${TARGET_URL}?product=${encodeURIComponent(product.product_name ?? "")}&brand=${encodeURIComponent(merchantBrandUrl)}`;

      // Symmetric model: product emits glideIn from MIDPOINT in the first
      // D/2 of its trim window. The "to" anchor (recorded cursor at
      // trim_start) is auto-computed inside cursor-track.ts.
      //
      // NO entry-morph on product: in the v4 layered pipeline, overlays
      // are CONCATENATED at the merge boundary (not crossfaded). Emitting
      // both intro's exit-morph (ending at product's webcam state, t=1)
      // AND product's entry-morph (starting at intro's webcam state, t=0)
      // creates a one-frame snap from t=1 → t=0 at the boundary — visible
      // as a stutter. Intro's exit-morph carries the whole transition;
      // product just plays from its natural webcam state, which already
      // matches the state intro lands on at the boundary.
      const productEntryMouseActive = mouseAnimated && !!mouseGlideMidpoint;
      const glideInPoint = productEntryMouseActive ? mouseGlideMidpoint : undefined;

      const productSpec = buildSectionSpec({
        webcam: productWebcam,
        webcamR2Key: product.webcam_url ?? null,
        trimStartSec: productTrimStartSec,
        trimEndSec: productTrimEndSec,
        glideInPoint,
        overlayDurationMs: effOverlayDurationMs,
        mouseDurationMs: Math.floor(effMouseDurationMs / 2),
        glideShape: glideShape ?? undefined,
      });

      productPayload = {
        url: productUrl,
        width: productRec.mouseData.virtualWidth,
        height: productRec.mouseData.virtualHeight,
        keyframes: productKeyframes,
        // Settle around glideIn's start so the rendered first frame already
        // has the page in a sensible hover state for the cursor's entry path.
        settleHint: glideInPoint ?? (productKeyframes.length > 0
          ? { x: productKeyframes[0].x, y: productKeyframes[0].y }
          : undefined),
        spec: productSpec,
        durationMs: productDuration,
        mouseEventsR2Key: product.mouse_events_url,
        webcamR2Key: product.webcam_url,
      };
    }

    // The transition forwarded to the worker reflects the post-clamp values:
    // crossfade kinds may have been downgraded to 'none' if the un-trimmed
    // audio was insufficient; durations are the clamped values.
    const effectiveTransition: Transitions = {
      ...transition,
      audio: effAudio,
      video: effVideo,
      audioDurationMs: effAudioDurationMs,
      videoDurationMs: effVideoDurationMs,
      overlayDurationMs: effOverlayDurationMs,
      mouseDurationMs: effMouseDurationMs,
    };

    const merge: MergeRenderSpec = {
      intro: merchantPayload?.spec,
      product: productPayload?.spec,
      transition: effectiveTransition,
    };

    const job = await jobsQueue.add("merge", {
      type: "merge",
      userId,
      renderId,
      brand,
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
