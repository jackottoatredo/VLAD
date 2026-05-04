import { createHash } from "node:crypto";
import type { WebcamMode, WebcamVertical, WebcamHorizontal } from "@/types/webcam";
import { DEFAULT_WEBCAM_SETTINGS, type WebcamSettings } from "@/types/webcam";
import {
  MOUSE_GLIDE_ARC_FRACTION,
  MOUSE_GLIDE_STUTTER_AMPLITUDE,
  MOUSE_GLIDE_STUTTER_FREQUENCY,
} from "@/app/config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebcamPosition = {
  vertical: WebcamVertical;
  horizontal: WebcamHorizontal;
};

export type Webcam = {
  mode: WebcamMode;
  position: WebcamPosition;
};

/**
 * Audio-reactive throb. When enabled, the audio-mode circle scales linearly
 * with the pre-baked amplitude track (sessions/.../webcam.amplitude.json).
 * Disabled in the recording flow per user spec.
 */
export type ThrobSpec = {
  enabled: boolean;
  /** R2 key to amplitude JSON. Null when no webcam audio (silent track). */
  amplitudeKey: string | null;
  minScale: number;
  maxScale: number;
};

/**
 * Cross-section morph. Section opens in `from*` state and CSS-transitions to
 * the resolved webcam over `durationMs`. Used at the start of the product
 * section in a merge when intro's end-state ≠ product's start-state.
 */
export type MorphSpec = {
  fromMode: WebcamMode;
  fromPosition: WebcamPosition;
  durationMs: number;
};

/**
 * Cross-section morph (exit). Section runs full duration; during the LAST
 * `durationMs`, the overlay animates from the section's resolved webcam state
 * to (toMode, toPosition). Used when transition.side = 'end-of-intro'.
 */
export type ExitMorphSpec = {
  toMode: WebcamMode;
  toPosition: WebcamPosition;
  durationMs: number;
};

/**
 * Glide path-shape knobs shared by entry and exit. Resolved server-side from
 * the modal's mouse-transition selection (linear/arched/natural):
 *   - linear:  arcFraction=0, stutterAmplitude=0
 *   - arched:  arcFraction>0, stutterAmplitude=0
 *   - natural: arcFraction>0, stutterAmplitude>0
 *
 * Embedding the resolved numbers in the spec keeps cache hashes correct when
 * the global config tunables change.
 */
export type MouseGlideShape = {
  /** Quadratic Bezier arc — fraction of |A−B| the control point is offset
   *  perpendicular-up from the straight midpoint. 0 = straight line. */
  arcFraction: number;
  /** Sine perturbation on the eased t. 0 = perfectly smooth velocity. */
  stutterAmplitude: number;
  /** Cycles of the speed wobble across the glide. Ignored when amplitude=0. */
  stutterFrequency: number;
};

/**
 * Mouse handoff between sections (entry). Before recorded events fire, glide
 * the cursor from `(fromX, fromY)` to the section's first event position.
 */
export type MouseHandoffSpec = {
  fromX: number;
  fromY: number;
  durationMs: number;
  easing: MouseEasing;
  shape: MouseGlideShape;
};

/**
 * Mouse exit glide. Section runs full replay; during the LAST `durationMs`,
 * the cursor sprite is overridden to glide from its position at the start of
 * the exit window to (toX, toY). Discrete events (clicks/keys) still fire at
 * their recorded positions during this window.
 *
 * `fromX`/`fromY` are optional explicit overrides for the start of the glide.
 * When omitted, the renderer captures the cursor's recorded position at the
 * exit-start frame. Set explicitly in the crossfade path so intro's exit
 * glide and product's entry glide trace the same path through the xfade
 * overlap (no sub-frame quantization drift).
 */
export type ExitMouseGlideSpec = {
  fromX?: number;
  fromY?: number;
  toX: number;
  toY: number;
  durationMs: number;
  easing: MouseEasing;
  shape: MouseGlideShape;
};

export type MouseEasing = "easeInOut" | "cubicEaseInOut";

export type TrimSpec = {
  startSec: number;
  endSec: number;
};

/**
 * Single source of truth for a section's render config. Routes resolve form
 * state + metadata into a RenderSpec; the worker consumes it without
 * re-resolving.
 *
 * Entry transitions (morph, mouseHandoff) play in the FIRST N ms of capture.
 * Exit transitions (exitMorph, exitMouseGlide) play in the LAST N ms of
 * capture. Routes never emit both entry and exit on the same section — the
 * `transition.side` choice picks one or the other.
 */
export type RenderSpec = {
  webcam: Webcam;
  morph?: MorphSpec;
  exitMorph?: ExitMorphSpec;
  throb?: ThrobSpec;
  mouseHandoff?: MouseHandoffSpec;
  exitMouseGlide?: ExitMouseGlideSpec;
  trim?: TrimSpec;
};

/**
 * Cross-section transitions applied at merge time AND threaded into per-
 * section RenderSpecs. Audio/video crossfade are pure FFmpeg merge-stage
 * filters; overlay/mouse are baked into one section's render (the side
 * field decides which section).
 *
 * `audio: 'crossfade'` is gated on both sections having real audio — when
 * either is silent (mode='off' or no webcam), the merge stage falls back
 * to plain concat regardless of this value.
 */
/**
 * Mouse transition style — picks the glide shape:
 *   - none:    cursor jumps at the boundary (no glide spec emitted).
 *   - linear:  straight A→B path, eased speed.
 *   - arched:  Bezier arc bowing up, eased speed.
 *   - natural: arched path with sine speed stutter (most human-feeling).
 */
export type MouseTransitionStyle = "none" | "linear" | "arched" | "natural";

export type Transitions = {
  audio: "none" | "crossfade";
  video: "none" | "crossfade";
  overlay: "none" | "animated";
  mouse: MouseTransitionStyle;
  side: "end-of-intro" | "start-of-product";
  /** 100..1000 ms in 100 ms steps. */
  durationMs: number;
};

export type MergeRenderSpec = {
  intro?: RenderSpec;
  product?: RenderSpec;
  transition: Transitions;
};

// ---------------------------------------------------------------------------
// Defaults / constants
// ---------------------------------------------------------------------------

export const DEFAULT_WEBCAM: Webcam = {
  mode: DEFAULT_WEBCAM_SETTINGS.webcamMode,
  position: {
    vertical: DEFAULT_WEBCAM_SETTINGS.webcamVertical,
    horizontal: DEFAULT_WEBCAM_SETTINGS.webcamHorizontal,
  },
};

export const DEFAULT_TRANSITION_DURATION_MS = 400;

export const DEFAULT_TRANSITIONS: Transitions = {
  audio: "none",
  video: "none",
  overlay: "none",
  mouse: "none",
  side: "start-of-product",
  durationMs: DEFAULT_TRANSITION_DURATION_MS,
};

/** Today's p1 default — overlay morph + natural mouse glide at start of product, both crossfades on. */
export const P1_TRANSITIONS: Transitions = {
  audio: "crossfade",
  video: "crossfade",
  overlay: "animated",
  mouse: "natural",
  side: "start-of-product",
  durationMs: DEFAULT_TRANSITION_DURATION_MS,
};

export const DEFAULT_THROB_MIN = 1.0;
export const DEFAULT_THROB_MAX = 1.2;
/** Legacy fallback when no transition is configured. */
export const DEFAULT_MORPH_DURATION_MS = 500;
export const DEFAULT_MOUSE_HANDOFF_MS = 300;

/** Clamp + snap a transition duration to the allowed 100..2000ms grid. */
export function snapTransitionDurationMs(ms: unknown): number {
  const n = typeof ms === "number" && Number.isFinite(ms) ? ms : DEFAULT_TRANSITION_DURATION_MS;
  const clamped = Math.max(100, Math.min(2000, n));
  return Math.round(clamped / 100) * 100;
}

// ---------------------------------------------------------------------------
// Form-state shapes (mirror of GenerateMergeModal IntroSettings/ProductSettings
// fields that affect resolution — kept loose so the route layer can pass either
// modal state or null for default behavior).
// ---------------------------------------------------------------------------

export type WebcamSource = "self" | "other" | "custom";

export type SectionFormSettings = {
  modeSource: WebcamSource;
  customMode: WebcamMode;
  positionSource: WebcamSource;
  customPosition: WebcamPosition;
};

// ---------------------------------------------------------------------------
// Metadata extraction (replaces the duplicated extractWebcamSettings in three
// API routes — single source of truth).
// ---------------------------------------------------------------------------

const VALID_MODES: WebcamMode[] = ["video", "audio", "off"];
const VALID_VERTICALS: WebcamVertical[] = ["top", "bottom"];
const VALID_HORIZONTALS: WebcamHorizontal[] = ["left", "right"];

export function extractWebcamFromMetadata(meta: Record<string, unknown> | null | undefined): Webcam {
  const m = meta ?? {};
  const mode =
    typeof m.webcamMode === "string" && (VALID_MODES as string[]).includes(m.webcamMode)
      ? (m.webcamMode as WebcamMode)
      : DEFAULT_WEBCAM.mode;
  const vertical =
    typeof m.webcamVertical === "string" && (VALID_VERTICALS as string[]).includes(m.webcamVertical)
      ? (m.webcamVertical as WebcamVertical)
      : DEFAULT_WEBCAM.position.vertical;
  const horizontal =
    typeof m.webcamHorizontal === "string" && (VALID_HORIZONTALS as string[]).includes(m.webcamHorizontal)
      ? (m.webcamHorizontal as WebcamHorizontal)
      : DEFAULT_WEBCAM.position.horizontal;
  return { mode, position: { vertical, horizontal } };
}

/** Convert a Webcam back to the legacy WebcamSettings shape (DB / payload bridge). */
export function webcamToSettings(w: Webcam): WebcamSettings {
  return {
    webcamMode: w.mode,
    webcamVertical: w.position.vertical,
    webcamHorizontal: w.position.horizontal,
  };
}

// ---------------------------------------------------------------------------
// Form-state resolution
// ---------------------------------------------------------------------------

function resolveModeField(
  form: SectionFormSettings | null | undefined,
  selfMode: WebcamMode,
  otherMode: WebcamMode | undefined,
): WebcamMode {
  if (!form) return selfMode;
  switch (form.modeSource) {
    case "self":
      return selfMode;
    case "other":
      // Graceful fallback when sibling is disabled (modal blocks this combo,
      // but fall back to self so we never produce undefined).
      return otherMode ?? selfMode;
    case "custom":
      return form.customMode;
  }
}

function resolvePositionField(
  form: SectionFormSettings | null | undefined,
  selfPosition: WebcamPosition,
  otherPosition: WebcamPosition | undefined,
): WebcamPosition {
  if (!form) return selfPosition;
  switch (form.positionSource) {
    case "self":
      return selfPosition;
    case "other":
      return otherPosition ?? selfPosition;
    case "custom":
      return form.customPosition;
  }
}

/**
 * Resolve a single section's webcam, given its own metadata, optional form
 * overrides, and the (optional) sibling section's already-resolved webcam.
 *
 * For merge flows where 'other' is in play, callers should resolve the
 * non-'other' section first and pass it as `otherWebcam` to the second call.
 * The modal blocks both sections from being 'other' simultaneously, so a
 * single fixed-order pass-1/pass-2 always terminates.
 */
export function resolveSectionWebcam(
  form: SectionFormSettings | null | undefined,
  selfWebcam: Webcam,
  otherWebcam?: Webcam,
): Webcam {
  return {
    mode: resolveModeField(form, selfWebcam.mode, otherWebcam?.mode),
    position: resolvePositionField(form, selfWebcam.position, otherWebcam?.position),
  };
}

/**
 * Resolve both sections' webcam settings for a merge. Handles the 2-pass
 * dance for 'other' references — at most one section can be 'other' (modal
 * enforces non-circularity), so we resolve the non-'other' first and then
 * the 'other' referencing it.
 */
export function resolveMergeWebcams(
  intro: { form?: SectionFormSettings | null; selfWebcam: Webcam } | null,
  product: { form?: SectionFormSettings | null; selfWebcam: Webcam } | null,
): { intro?: Webcam; product?: Webcam } {
  // Pass 1: resolve sections that don't reference 'other'.
  const introHasOther =
    !!intro?.form && (intro.form.modeSource === "other" || intro.form.positionSource === "other");
  const productHasOther =
    !!product?.form && (product.form.modeSource === "other" || product.form.positionSource === "other");

  let introWebcam: Webcam | undefined;
  let productWebcam: Webcam | undefined;

  if (intro && !introHasOther) {
    introWebcam = resolveSectionWebcam(intro.form, intro.selfWebcam);
  }
  if (product && !productHasOther) {
    productWebcam = resolveSectionWebcam(product.form, product.selfWebcam);
  }

  // Pass 2: resolve 'other' references using pass 1 results.
  if (intro && introHasOther) {
    introWebcam = resolveSectionWebcam(intro.form, intro.selfWebcam, productWebcam);
  }
  if (product && productHasOther) {
    productWebcam = resolveSectionWebcam(product.form, product.selfWebcam, introWebcam);
  }

  return { intro: introWebcam, product: productWebcam };
}

// ---------------------------------------------------------------------------
// Webcam equality (drives morph emission — only when end-state ≠ start-state)
// ---------------------------------------------------------------------------

export function webcamEquals(a: Webcam, b: Webcam): boolean {
  return (
    a.mode === b.mode &&
    a.position.vertical === b.position.vertical &&
    a.position.horizontal === b.position.horizontal
  );
}

// ---------------------------------------------------------------------------
// Stable hash of a RenderSpec for cache keys (excludes `trim` since trim is
// its own cache stage; `mouseHandoff` is included because handoff position
// affects rendered frames).
// ---------------------------------------------------------------------------

export function specHashInput(spec: RenderSpec): string {
  // Deterministic stringification — keys in fixed order.
  const w = spec.webcam;
  const parts: string[] = [
    `wm=${w.mode}`,
    `wv=${w.position.vertical}`,
    `wh=${w.position.horizontal}`,
  ];
  if (spec.morph) {
    parts.push(
      `mfm=${spec.morph.fromMode}`,
      `mfv=${spec.morph.fromPosition.vertical}`,
      `mfh=${spec.morph.fromPosition.horizontal}`,
      `md=${spec.morph.durationMs}`,
    );
  }
  if (spec.exitMorph) {
    parts.push(
      `xmm=${spec.exitMorph.toMode}`,
      `xmv=${spec.exitMorph.toPosition.vertical}`,
      `xmh=${spec.exitMorph.toPosition.horizontal}`,
      `xmd=${spec.exitMorph.durationMs}`,
    );
  }
  if (spec.throb) {
    parts.push(
      `te=${spec.throb.enabled ? 1 : 0}`,
      `tk=${spec.throb.amplitudeKey ?? ""}`,
      `tn=${spec.throb.minScale}`,
      `tx=${spec.throb.maxScale}`,
    );
  }
  if (spec.mouseHandoff) {
    parts.push(
      `mhx=${spec.mouseHandoff.fromX}`,
      `mhy=${spec.mouseHandoff.fromY}`,
      `mhd=${spec.mouseHandoff.durationMs}`,
      `mhe=${spec.mouseHandoff.easing}`,
      `mha=${spec.mouseHandoff.shape.arcFraction}`,
      `mhsa=${spec.mouseHandoff.shape.stutterAmplitude}`,
      `mhsf=${spec.mouseHandoff.shape.stutterFrequency}`,
    );
  }
  if (spec.exitMouseGlide) {
    parts.push(
      `xmgx=${spec.exitMouseGlide.toX}`,
      `xmgy=${spec.exitMouseGlide.toY}`,
      `xmgfx=${spec.exitMouseGlide.fromX ?? ""}`,
      `xmgfy=${spec.exitMouseGlide.fromY ?? ""}`,
      `xmgd=${spec.exitMouseGlide.durationMs}`,
      `xmge=${spec.exitMouseGlide.easing}`,
      `xmga=${spec.exitMouseGlide.shape.arcFraction}`,
      `xmgsa=${spec.exitMouseGlide.shape.stutterAmplitude}`,
      `xmgsf=${spec.exitMouseGlide.shape.stutterFrequency}`,
    );
  }
  return parts.join("|");
}

/** Stable 16-char hex hash of a RenderSpec — drives cache field keys. */
export function hashSpec(spec: RenderSpec): string {
  return createHash("sha256").update(specHashInput(spec)).digest("hex").slice(0, 16);
}

/**
 * Resolve a `MouseTransitionStyle` (modal selection) into the path-shape
 * knobs that the renderer applies. Returns null when style='none' — caller
 * should not emit a handoff/exit-glide spec in that case.
 */
export function resolveGlideShape(style: MouseTransitionStyle): MouseGlideShape | null {
  switch (style) {
    case "none":
      return null;
    case "linear":
      return { arcFraction: 0, stutterAmplitude: 0, stutterFrequency: 0 };
    case "arched":
      return {
        arcFraction: MOUSE_GLIDE_ARC_FRACTION,
        stutterAmplitude: 0,
        stutterFrequency: 0,
      };
    case "natural":
      return {
        arcFraction: MOUSE_GLIDE_ARC_FRACTION,
        stutterAmplitude: MOUSE_GLIDE_STUTTER_AMPLITUDE,
        stutterFrequency: MOUSE_GLIDE_STUTTER_FREQUENCY,
      };
  }
}

/** Stable trim key string — kept separate from spec hash so trim can cache independently. */
export function trimKeyOf(spec: RenderSpec): string {
  const t = spec.trim;
  return `${(t?.startSec ?? 0).toFixed(3)}_${(t?.endSec ?? 0).toFixed(3)}`;
}
