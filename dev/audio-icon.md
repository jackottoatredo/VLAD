# Audio icon morph — handoff for the next agent

A single parameterised SVG that animates from a "webcam circle" steady state, through a tiny pinch point, into an "audio icon" steady state, with an audio-reactive throb halo. Two CSS custom properties drive the whole thing.

This document explains what exists, how to drive it, and what still has to be wired into the render pipeline.

## Files

| File | Role |
|---|---|
| [`public/audio-icon.svg`](../public/audio-icon.svg) | **Canonical SVG.** Single source of truth for radii, colors, layer order, and the parameterisation math. |
| [`public/svg-test/svg-test.html`](../public/svg-test/svg-test.html) | **Scratch test page.** Inlines a copy of the SVG with two range sliders for `--t` and `--v`, plus "bounce" and "pulse" auto-animators. Open at `http://localhost:3000/svg-test/svg-test.html` while `next dev` is running. |
| [`public/audio-icon-1.svg`](../public/audio-icon-1.svg) | **Design reference: state 1 (t=0).** Webcam state. Large blue circle in front, mic/throb hidden behind. r=200. |
| [`public/audio-icon-2.svg`](../public/audio-icon-2.svg) | **Design reference: state 2 (t≈0.5).** Transition pinch point — every shape collapsed to ~r=7. |
| [`public/audio-icon-3.svg`](../public/audio-icon-3.svg) | **Design reference: state 3 (t=1, v=0).** Audio idle state. Small mic-on-black with thin throb halo. r=100. |
| [`public/audio-icon-4.svg`](../public/audio-icon-4.svg) | **Design reference: state 3 (t=1, v=1).** Audio max-volume state. Same mic, throb halo expanded. |

The four numbered SVGs are the visual targets; `audio-icon.svg` is the parameterised version that interpolates between them.

## Parameter contract

The SVG accepts two CSS custom properties on the `<svg>` element:

| Property | Range | Drives | Notes |
|---|---|---|---|
| `--t` | 0..1 | morph progress | 0 = state 1, 0.5 = state 2 (pinch), 1 = state 3. Drive with a spring curve from the caller — the SVG itself just renders the static state at any `t`. |
| `--v` | 0..1 | volume / throb scale | Linearly mapped to throb radius scale `[1.0, 1.2]`. Animate per-frame from a pre-baked amplitude track. |

Default values are `0` and `0` (state 1 with no throb).

## How the math works

The non-monotonic radius (200 → 7 → 100) and the z-order swap at the midpoint both fall out of two derived progress helpers, defined inline in the SVG:

```
--collapse: clamp(0, calc(var(--t) * 2), 1)      // 0→1 over t∈[0, 0.5], stays 1
--expand:   clamp(0, calc(var(--t) * 2 - 1), 1)  // stays 0, then 0→1 over t∈[0.5, 1]
```

Every animated value is a linear combination of these:

```
r(t)         = 200 − 193·collapse + 93·expand          // primary radius
r_throb(t,v) = (206 − 193·collapse + 93·expand) · (1 + 0.2·v)
mic-scale(t) = (200 − 193·collapse + 93·expand) / 200  // mic group transform: scale(...)
back-op(t)   = expand                                  // webcam-back / mic group opacity
front-op(t)  = 1 − collapse                            // webcam-front opacity
```

Plugging the keyframes:
- t=0 → collapse=0, expand=0 → r=200, front-op=1, back-op=0 (state 1) ✓
- t=0.5 → collapse=1, expand=0 → r=7, front-op=0, back-op=0 (state 2) ✓
- t=1 → collapse=1, expand=1 → r=100, front-op=0, back-op=1 (state 3) ✓

## Z-order swap (the trick)

The "webcam moves to the back at the transition" effect is done with **two webcam circles** in the SVG simultaneously, never reordering layers. Their opacities cross-fade around the midpoint:

```
draw order (back → front):
  1. webcam-back   (opacity = expand,        below throb)
  2. throb-halo    (always visible)
  3. mic-group     (opacity = expand,        above throb)
  4. webcam-front  (opacity = 1 − collapse,  above mic)
```

At t=0 only `webcam-front` is visible. At t=1 only `webcam-back`, `throb`, and `mic-group` are visible. The "swap" is invisible because at the midpoint both webcam circles are tiny (r ≈ 7) and the mic-group is also at scale ≈ 0.035 — there's nothing visible to disagree about z-order over.

## How to drive it

External `<img src="...">` SVGs render in a sandboxed style scope and **don't inherit CSS variables** from the parent document. To drive `--t` and `--v` from JS, you must inline the SVG content into the host document:

```js
const svg = document.getElementById('icon');         // inline <svg>, NOT an <img>
svg.style.setProperty('--t', String(currentT));      // per-frame
svg.style.setProperty('--v', String(amplitude[i]));
```

The scratch test page ([`public/svg-test/svg-test.html`](../public/svg-test/svg-test.html)) demonstrates this pattern. Open it and inspect the script tag.

### Suggested `t` curve

A "spring" feel — linear collapse, eased overshoot expand:

```js
function tAtElapsed(elapsedMs) {
  const collapseMs = 300;
  const expandMs = 600;
  if (elapsedMs < collapseMs) {
    return (elapsedMs / collapseMs) * 0.5;            // 0 → 0.5 linear
  }
  const e = (elapsedMs - collapseMs) / expandMs;
  if (e >= 1) return 1;
  // easeOutBack — overshoots past 1 and settles
  const c1 = 1.70158, c3 = c1 + 1;
  return 0.5 + (1 + c3 * Math.pow(e - 1, 3) + c1 * Math.pow(e - 1, 2)) * 0.5;
}
```

This is exactly the `bounce` animator in the test page — feel free to reuse.

### Suggested `v` curve

The pipeline already pre-bakes per-frame amplitude at upload time — see [`lib/audio/amplitude.ts`](../lib/audio/amplitude.ts) and the `amplitude.json` artifact in R2. At render time, look up `samples[frameIdx]` and pass through directly to `--v`.

## Integration status

### ✅ Done

- Design (the four reference SVGs).
- Parameterised SVG with the `--t` / `--v` contract.
- Closed-form interpolation that exactly hits all three keyframes.
- Z-order swap via opacity (no layer reorder needed).
- Scratch test page with sliders + bounce + pulse animators for visual iteration.
- Throb stroke (thin orange ring on the halo).

### ⏳ Remaining

#### 1. Replace blue placeholders with the actual webcam content

Both `webcam-front` and `webcam-back` are currently solid `#4584D5` placeholder fills. The blue marks where the **real webcam frame** belongs.

The pipeline already pre-bakes per-frame webcam JPEGs at upload time — see [`lib/audio/webcam-frames.ts`](../lib/audio/webcam-frames.ts) (called from [`app/api/save-webcam/route.ts`](../app/api/save-webcam/route.ts)). At render time the worker fetches the bundle and has `frames[frameIdx]` as a `Buffer`.

Two approaches:

**A. `<image>` element clipped to the circle (simpler).** Replace each blue `<circle>` with:
```svg
<defs>
  <clipPath id="webcam-clip">
    <circle cx="256" cy="256" style="r: var(--r)" />
  </clipPath>
</defs>
<image href="data:image/jpeg;base64,..." x="56" y="56" width="400" height="400"
       preserveAspectRatio="xMidYMid slice" clip-path="url(#webcam-clip)" />
<circle cx="256" cy="256" style="r: var(--r); fill: none;"
        stroke="#FF4405" stroke-width="12" />  <!-- border on top -->
```
Per-frame, the caller swaps `image.href.baseVal` with the next frame's data URL. Cheap, no decode-during-playback issues. The two clipPaths (front + back) can share the same `webcam-clip` definition since they're at the same radius.

**B. `<foreignObject>` containing a `<video>` element (originally proposed).** More elegant, but seeking a `<video>` element per frame is unreliable — that's why the bake-frames-up-front approach exists in the first place. Avoid this unless you have a specific reason.

Go with A.

#### 2. Replace the current two-wrap overlay with this SVG

[`lib/render/overlay.ts`](../lib/render/overlay.ts) currently injects two separate DOM wraps (`videoWrap` and `audioWrap`) and toggles their opacity to swap modes. Replace that whole structure with one inlined copy of `audio-icon.svg`'s contents.

The overlay-tick path then simplifies to:

```js
function tick(frameIdx, totalFrames, spec, amplitude) {
  const t = computeT(frameIdx, totalFrames, spec.morph, spec.exitMorph);
  const v = amplitude?.[frameIdx] ?? 0;
  svg.style.setProperty('--t', String(t));
  svg.style.setProperty('--v', String(v));

  // Webcam frame swap (per option A above)
  const frame = webcamFrames[frameIdx];
  if (frame) image.setAttribute('href', frame.dataUrl);
}
```

#### 3. Wrap-level corner morph (translate + scale)

The SVG's `--t` drives the **internal** morph (webcam state ↔ audio state). The **outer** geometry — moving the icon's center toward the corner as it shrinks — lives on the wrapping `<div>`, not inside the SVG.

We worked this out in conversation already (see git history of [`lib/render/overlay.ts`](../lib/render/overlay.ts) and earlier replies in the chat log):

```js
const radiusT  = R + (r - R) * t;                                       // visual outer radius
const cx = (horizontal === 'left' ? m + radiusT : W - m - radiusT);
const cy = (vertical   === 'top'  ? m + radiusT : H - m - radiusT);
const morphScale = radiusT / R;

wrap.style.left = (cx - R) + 'px';                  // wrap is constant 2R × 2R; center on (cx, cy)
wrap.style.top  = (cy - R) + 'px';
wrap.style.transform = `scale(${morphScale})`;
wrap.style.transformOrigin = '50% 50%';
```

Where `R` and `r` come from [`app/config.ts`](../app/config.ts) (`WEBCAM_OVERLAY_DIAMETER / 2` for `R`; `r` is a new constant — half of whatever the audio-state visual diameter should be).

The wrap-level morph and the SVG-internal morph are **driven by the same `t`** so they stay in lock-step.

#### 4. Tune the spring curve

Current placeholder uses `easeOutBack` for the expand phase. Other curves to try:
- `easeOutBounce` — multi-bounce, more cartoonish
- `easeOutElastic` — overshoots multiple times before settling
- A custom spring with damping ratio + frequency knobs (see [Spring Animations in React Spring's docs](https://react-spring.dev/) for the math, or just hardcode `damping=0.7, stiffness=200`)

The scratch test page has a "bounce t" button that runs the current curve — iterate visually there.

## Caveats & gotchas

- **Inline only.** The SVG cannot be served as an `<img>` source if you want JS to drive the parameters. Inline its contents into the parent DOM.
- **Two copies in the repo right now.** [`public/audio-icon.svg`](../public/audio-icon.svg) and the inlined block inside [`public/svg-test/svg-test.html`](../public/svg-test/svg-test.html) are independent. If you tweak one, sync the other (or refactor the test page to fetch+inline at runtime).
- **Stroke is centered, not outside.** The throb's `stroke-width="4"` is half-inside, half-outside the geometric circle. If you ever need the stroke purely outside, add `paint-order="stroke fill"` and reduce the radius math by `2`. Same goes for the webcam circles' `stroke-width="12"`.
- **`transform-box` defaults.** SVG element CSS `transform-origin` is in viewBox user-units by default (`transform-box: view-box`). The mic group's `transform-origin: 256px 256px` lands at the icon center — don't change it unless you also change the cx/cy of the inner circles.
- **Radius units.** `r: var(--r)` works because `--r` evaluates to a `<length>` (the inline `calc()` multiplies by `1px`). If you tweak the math, keep at least one `px` unit in each calc — bare numbers won't satisfy the `<length>` requirement of the `r` CSS property.
- **Browser support.** All used CSS features (custom properties, `clamp()` in `calc()`, `r` as a CSS property, `transform-box`) are well-supported in Chromium. The renderer runs headless Chromium, so we don't need cross-browser fallbacks.

## Quick-start for the next agent

1. Open `http://localhost:3000/svg-test/svg-test.html` and play with the sliders to internalise what the SVG does.
2. Read [`public/audio-icon.svg`](../public/audio-icon.svg) — comments inside explain every layer.
3. Read [`lib/render/overlay.ts`](../lib/render/overlay.ts) to see the current two-wrap structure that needs replacing.
4. Implement integration step 1 (image element with frame swap) first — it's the pre-req for everything else.
5. Then steps 2 and 3 in either order.
6. Tune (step 4) last, with the full pipeline running so you can iterate on real merge renders.
