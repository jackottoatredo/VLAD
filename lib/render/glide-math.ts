import type { MouseEasing, MouseGlideShape } from "@/lib/render/spec";

export const STRAIGHT_SHAPE: MouseGlideShape = {
  arcFraction: 0,
  stutterAmplitude: 0,
  stutterFrequency: 0,
};

export function clampCoordinate(value: number, max: number): number {
  return Math.min(Math.max(value, 0), Math.max(max - 1, 0));
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

function cubicEaseInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function applyEasing(t: number, easing: MouseEasing): number {
  return easing === "cubicEaseInOut" ? cubicEaseInOut(t) : easeInOut(t);
}

/**
 * Perturb the eased glide parameter so the cursor's speed wobbles slightly
 * along the path. Deterministic — driven by linear `t`, so frequency stays
 * uniform in time regardless of easing. The `sin(π·t)` envelope keeps the
 * perturbation at 0 at both endpoints, so the cursor still lands exactly.
 */
export function applyGlideStutter(
  easedT: number,
  t: number,
  amplitude: number,
  frequency: number,
): number {
  if (amplitude === 0) return easedT;
  const envelope = Math.sin(Math.PI * t);
  const wiggle = Math.sin(2 * Math.PI * frequency * t);
  const perturbed = easedT + amplitude * envelope * wiggle;
  return Math.max(0, Math.min(1, perturbed));
}

/**
 * Quadratic Bezier sample along an arc from `from` to `to`, parameterised by
 * eased `t` ∈ [0, 1]. The control point is pinned ABOVE the straight-line
 * midpoint (toward y=0) by `arcFraction × distance` — a consistent upward bow
 * that mimics the natural pivot of an arm/wrist over a desk surface.
 */
export function arcedGlidePoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number,
  arcFraction: number,
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { x: from.x, y: from.y };

  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2 - dist * arcFraction;

  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
    y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
  };
}
