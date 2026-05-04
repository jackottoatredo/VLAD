import { createHash } from "node:crypto";
import type { WebcamMode, WebcamVertical, WebcamHorizontal } from "@/types/webcam";
import { DEFAULT_WEBCAM_SETTINGS, type WebcamSettings } from "@/types/webcam";

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
 * Mouse handoff between sections. Before recorded events fire, glide the
 * cursor from `(fromX, fromY)` to the section's first event position.
 */
export type MouseHandoffSpec = {
  fromX: number;
  fromY: number;
  durationMs: number;
  easing: "easeInOut";
};

export type TrimSpec = {
  startSec: number;
  endSec: number;
};

/**
 * Single source of truth for a section's render config. Routes resolve form
 * state + metadata into a RenderSpec; the worker consumes it without
 * re-resolving.
 */
export type RenderSpec = {
  webcam: Webcam;
  morph?: MorphSpec;
  throb?: ThrobSpec;
  mouseHandoff?: MouseHandoffSpec;
  trim?: TrimSpec;
};

/**
 * Cross-section transitions. Schema-only in v1; only `'none'` is honored
 * by the worker. Other values may appear in payloads but should be treated
 * as `'none'`.
 */
export type Transitions = {
  audio: "none" | "crossfade";
  video: "none" | "crossfade";
  overlay: "none" | "animated";
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

export const DEFAULT_TRANSITIONS: Transitions = {
  audio: "none",
  video: "none",
  overlay: "none",
};

export const DEFAULT_THROB_MIN = 1.0;
export const DEFAULT_THROB_MAX = 1.2;
export const DEFAULT_MORPH_DURATION_MS = 500;
export const DEFAULT_MOUSE_HANDOFF_MS = 300;

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
    );
  }
  return parts.join("|");
}

/** Stable 16-char hex hash of a RenderSpec — drives cache field keys. */
export function hashSpec(spec: RenderSpec): string {
  return createHash("sha256").update(specHashInput(spec)).digest("hex").slice(0, 16);
}

/** Stable trim key string — kept separate from spec hash so trim can cache independently. */
export function trimKeyOf(spec: RenderSpec): string {
  const t = spec.trim;
  return `${(t?.startSec ?? 0).toFixed(3)}_${(t?.endSec ?? 0).toFixed(3)}`;
}
