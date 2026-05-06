import { type Page } from "playwright";
import type { RenderSpec } from "@/lib/render/spec";
import {
  WEBCAM_OVERLAY_DIAMETER,
  AUDIO_OVERLAY_DIAMETER,
  AUDIO_THROB_MAX_SCALE,
  WEBCAM_OVERLAY_MARGIN,
  WEBCAM_BORDER_COLOR,
} from "@/app/config";

/**
 * Base URL the page-side overlay loads webcam frames from. Each frame is
 * fetched as `${WEBCAM_FRAME_URL_BASE}{N}.jpg` and intercepted by Playwright's
 * `page.route`, served from the in-memory frame bundle the worker resolved.
 */
export const WEBCAM_FRAME_URL_BASE = "https://__vlad_overlay__/frame_";

export type InjectOverlayOptions = {
  spec: RenderSpec;
  /** True when frame data is available — tells the overlay to load per-frame
   *  webcam JPEGs into the SVG `<image>` elements. */
  hasWebcam: boolean;
  /** Pre-baked amplitude samples [0,1], one per video frame at `fps`. Null when no audio data. */
  amplitudeSamples: number[] | null;
  /** Render fps. */
  fps: number;
  /** Render zoom factor — overlay sizes are virtual-px / zoom = CSS-px. */
  zoom: number;
  /** Total number of capture frames in this section. Anchors the entry/exit
   *  morph windows. */
  totalFrames: number;
};

/**
 * SVG path data for the white mic icon (from public/audio-icon.svg). Embedded
 * here so the overlay install script doesn't need to fetch the SVG at runtime.
 * If the design changes, sync from the canonical SVG.
 */
const MIC_PATH =
  "M227.454 212.591C222.452 205.138 217.773 197.033 217.773 187.296C217.773 166.515 234.446 149.706 254.938 149.815C275.43 149.706 292.103 166.515 292.103 187.296C292.103 197.033 287.424 205.138 282.422 212.591C277.796 219.554 273.924 224.722 270.159 230.542C265.049 238.865 261.392 246.372 261.392 256.001C261.392 265.629 264.996 273.843 270.159 281.459C273.547 287.28 277.796 292.448 282.422 299.41C287.424 306.863 292.103 314.968 292.103 324.706C292.103 345.485 275.43 362.295 254.938 362.185C234.446 362.295 217.773 345.485 217.773 324.706C217.773 314.968 222.452 306.863 227.454 299.41C232.08 292.448 236.329 287.28 239.717 281.459C244.881 273.843 248.484 265.629 248.484 256.001C248.484 246.372 244.827 238.865 239.717 230.542C235.952 224.722 232.08 219.554 227.454 212.591Z";

/**
 * Page-side install script. Plain JavaScript IIFE — not transpiled by esbuild,
 * so it can't accumulate `__name` helper calls that would fail to resolve in
 * the browser context.
 *
 * Defines window.__vlad_overlay__ = { setup, tick }. The DOM is one wrap div
 * containing one inline SVG (the audio-icon morphable). Per frame, `tick()`:
 *
 *   - drives `--t` (spring(morphT)) and `--v` (amplitude[i]) on the SVG
 *   - sets the wrap's left/top to a corner-anchored center, lerped between
 *     the from-corner and to-corner of the morph (linear in morphT)
 *   - sets the wrap's `transform: scale()` to override the SVG's natural
 *     audio-state radius (R/2) toward the configured `r` value
 *   - sets the wrap's opacity (handles 'off' mode fade)
 *   - swaps the SVG `<image>` href for the next webcam frame, awaiting a
 *     decode on a hidden HTML `<img>` so Playwright captures the right pixel
 *
 * The two `<image>` elements (back and front) share the same href so a single
 * preload covers both. They're z-stacked with the throb and mic-group between
 * them; the back/front opacity blend is what drives the morph's "z-order
 * swap" without ever reordering layers.
 */
const OVERLAY_INSTALL_SCRIPT = `
(function () {
  if (window.__vlad_overlay__) return;

  // Inverted-parabola velocity profile: fast at the endpoints, slow at the
  // pinch, fast again to the audio icon. Implemented as 80% cubic
  // 4·(t-0.5)³+0.5 (which has v=12·(t-0.5)² — zero velocity at t=0.5)
  // blended 20% with linear so the morph doesn't fully freeze at the
  // pinch. Velocity peaks ~2.6× linear at the endpoints; minimum ~0.2×
  // at the pinch — gives the "spring" feel the user described.
  function springT(linearT) {
    var lt = Math.max(0, Math.min(1, linearT));
    var cubic = 4 * Math.pow(lt - 0.5, 3) + 0.5;
    return 0.8 * cubic + 0.2 * lt;
  }

  // SVG-internal radius (viewBox units) at any t. Mirrors the math in
  // public/audio-icon.svg's <g style="--r: calc(...)">.
  function rSvg(t) {
    var tc = Math.max(0, Math.min(1, t));
    var collapse = Math.min(tc * 2, 1);
    var expand = Math.max(0, tc * 2 - 1);
    return 200 - 193 * collapse + 93 * expand;
  }

  // Mode → t value. 'off' has no t state — handled via opacity, not --t.
  function modeT(mode) {
    if (mode === 'video') return 0;
    if (mode === 'audio') return 1;
    return null;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function cornerCenter(pos, visualOuter, m, W, H) {
    return {
      cx: pos.horizontal === 'left' ? m + visualOuter : W - m - visualOuter,
      cy: pos.vertical === 'top' ? m + visualOuter : H - m - visualOuter,
    };
  }

  window.__vlad_overlay__ = {
    setup: function (cfg) {
      if (document.getElementById('__vlad_overlay_root__')) return;

      var root = document.createElement('div');
      root.id = '__vlad_overlay_root__';
      root.style.cssText =
        'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646;';

      var wrap = document.createElement('div');
      wrap.id = '__vlad_overlay_wrap__';
      wrap.style.cssText =
        'position:absolute;width:' + cfg.wrapSize + 'px;height:' + cfg.wrapSize + 'px;' +
        'left:0;top:0;opacity:0;transform-origin:50% 50%;will-change:transform,opacity,left,top;';

      // Hidden HTML <img> for decode-tracking. SVG <image> doesn't expose
      // .decode(); we preload via this <img> and rely on the browser cache
      // to make the SVG <image> swap instant.
      var preloadImg = document.createElement('img');
      preloadImg.style.cssText = 'display:none;';
      preloadImg.alt = '';

      // Inline SVG content. ViewBox 0..512; the wrap's CSS size scales the
      // SVG so viewBox r=200 (the t=0 webcam radius) maps to the configured
      // R in CSS pixels. Throb halo and mic-group scale internally.
      //
      // CRITICAL: the derived custom properties (--collapse, --expand, --r,
      // --r-throb, --mic-scale, --back-op, --front-op) MUST live on the
      // <svg> element, not on a child <g>. The <clipPath> inside <defs> is
      // a sibling of <g>, not a descendant, so vars defined on <g> wouldn't
      // propagate sideways into the clipPath — its r:var(--r) would resolve
      // to nothing and the webcam <image> would clip to zero. Vars on <svg>
      // cascade to every descendant including <defs>.
      wrap.innerHTML = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" preserveAspectRatio="xMidYMid meet" ' +
        'style="' +
          '--t:0;--v:0;' +
          '--collapse:clamp(0,calc(var(--t) * 2),1);' +
          '--expand:clamp(0,calc(var(--t) * 2 - 1),1);' +
          '--r:calc(200px - 193px * var(--collapse) + 93px * var(--expand));' +
          '--r-throb:calc((206px - 193px * var(--collapse) + 93px * var(--expand)) * (1 + ' + cfg.throbModulation + ' * var(--v)));' +
          '--mic-scale:calc((200 - 193 * var(--collapse) + 93 * var(--expand)) / 200);' +
          '--back-op:var(--expand);' +
          '--front-op:calc(1 - var(--collapse));' +
          'width:100%;height:100%;display:block;overflow:visible;' +
          'filter:drop-shadow(0 0 5px rgba(0,0,0,0.5));' +
        '">' +
          '<defs>' +
            '<clipPath id="__vlad_webcam_clip__">' +
              '<circle cx="256" cy="256" style="r:var(--r);"></circle>' +
            '</clipPath>' +
          '</defs>' +
          '<image id="__vlad_webcam_back__" href="" x="56" y="56" width="400" height="400" ' +
            'preserveAspectRatio="xMidYMid slice" clip-path="url(#__vlad_webcam_clip__)" ' +
            'style="opacity:var(--back-op);"></image>' +
          '<circle cx="256" cy="256" style="r:var(--r);fill:none;opacity:var(--back-op);" ' +
            'stroke="' + cfg.borderColor + '" stroke-width="12"></circle>' +
          '<circle cx="256" cy="256" style="r:var(--r-throb);" ' +
            'fill="' + cfg.borderColor + '" fill-opacity="0.5" ' +
            'stroke="' + cfg.borderColor + '" stroke-width="4"></circle>' +
          '<g style="opacity:var(--back-op);transform-origin:256px 256px;transform:scale(var(--mic-scale));">' +
            '<circle cx="256" cy="256" r="200" fill="black" stroke="' + cfg.borderColor + '" stroke-width="12"></circle>' +
            '<path fill="white" d="' + cfg.micPath + '"></path>' +
          '</g>' +
          '<image id="__vlad_webcam_front__" href="" x="56" y="56" width="400" height="400" ' +
            'preserveAspectRatio="xMidYMid slice" clip-path="url(#__vlad_webcam_clip__)" ' +
            'style="opacity:var(--front-op);"></image>' +
          '<circle cx="256" cy="256" style="r:var(--r);fill:none;opacity:var(--front-op);" ' +
            'stroke="' + cfg.borderColor + '" stroke-width="12"></circle>' +
        '</svg>'
      );

      root.appendChild(wrap);
      root.appendChild(preloadImg);
      document.body.appendChild(root);

      window.__vlad_overlay_state__ = {
        cfg: cfg,
        wrap: wrap,
        svg: wrap.querySelector('svg'),
        webcamBack: wrap.querySelector('#__vlad_webcam_back__'),
        webcamFront: wrap.querySelector('#__vlad_webcam_front__'),
        preloadImg: preloadImg,
      };
    },

    tick: function (frameIdx) {
      var state = window.__vlad_overlay_state__;
      if (!state) return Promise.resolve();
      var cfg = state.cfg;
      var spec = cfg.spec;
      var fps = cfg.fps;
      var totalFrames = cfg.totalFrames;
      var W = window.innerWidth;
      var H = window.innerHeight;

      // 1. Resolve from/target modes + positions and morph progress (linear).
      var fromMode = spec.webcam.mode;
      var targetMode = spec.webcam.mode;
      var fromPos = spec.webcam.position;
      var targetPos = spec.webcam.position;
      var morphT = 1;

      if (spec.morph) {
        // Entry morph: fromMode/Pos → spec.webcam over the first N frames.
        fromMode = spec.morph.fromMode;
        fromPos = spec.morph.fromPosition;
        var entryElapsedMs = frameIdx * (1000 / fps);
        morphT = Math.max(0, Math.min(entryElapsedMs / spec.morph.durationMs, 1));
      } else if (spec.exitMorph) {
        // Exit morph: spec.webcam → toMode/Pos over the last N frames.
        var exitFrameCount = Math.max(1, Math.ceil((spec.exitMorph.durationMs / 1000) * fps));
        var exitStart = totalFrames - exitFrameCount;
        if (frameIdx >= exitStart) {
          targetMode = spec.exitMorph.toMode;
          targetPos = spec.exitMorph.toPosition;
          morphT = Math.max(0, Math.min((frameIdx - exitStart + 1) / exitFrameCount, 1));
        } else {
          targetMode = spec.webcam.mode;
          targetPos = spec.webcam.position;
          morphT = 0;
        }
      }

      // 2. SVG --t: spring curve across morph window. 'off' on either side
      //    locks --t to whichever side IS defined (and opacity fades the
      //    wrap separately).
      var fromTVal = modeT(fromMode);
      var targetTVal = modeT(targetMode);
      var svgT;
      if (fromTVal !== null && targetTVal !== null) {
        var linearT = lerp(fromTVal, targetTVal, morphT);
        svgT = springT(linearT);
      } else if (targetTVal !== null) {
        svgT = targetTVal;
      } else if (fromTVal !== null) {
        svgT = fromTVal;
      } else {
        svgT = 0;
      }

      // 3. Wrap opacity: 0 when 'off' is active, fades during morph.
      var fromAlpha = (fromMode === 'off') ? 0 : 1;
      var targetAlpha = (targetMode === 'off') ? 0 : 1;
      var wrapOpacity = lerp(fromAlpha, targetAlpha, morphT);

      // 4. --v: amplitude this frame (drives throb halo).
      var v = 0;
      if (spec.throb && spec.throb.enabled && cfg.amplitude && cfg.amplitude.length > 0) {
        var ampIdx = Math.min(frameIdx, cfg.amplitude.length - 1);
        v = cfg.amplitude[ampIdx] || 0;
      }

      // 5. Wrap scale: linear lerp(1, 2r/R) by --t. At t=0 scale=1 (visual=R);
      //    at t=1 scale=2r/R (visual=R*0.5*2r/R=r).
      var R = cfg.R_css;
      var r = cfg.r_css;
      var svgTClamped = Math.max(0, Math.min(1, svgT));
      var scaleAtT = lerp(1, 2 * r / R, svgTClamped);

      // 6. Visual outer at the FROM and TARGET endpoints. These anchor the
      //    corner positions so the icon's edge stays tangent to the margin
      //    at each end of the morph.
      function visualOuter(t) {
        var tc = Math.max(0, Math.min(1, t));
        return R * (rSvg(tc) / 200) * lerp(1, 2 * r / R, tc);
      }
      var fromVisual = visualOuter(fromTVal !== null ? fromTVal : svgT);
      var targetVisual = visualOuter(targetTVal !== null ? targetTVal : svgT);

      // 7. Corner-anchored centers, lerped by 2x morphT (clamped to 1).
      //    Position completes by morphT = 0.5 (the pinch), then stays put
      //    for the expand half — slide finishes WHILE the icon shrinks to
      //    the pinch, and the audio-icon springs up at the destination.
      var m = cfg.PAD;
      var fromCorner = cornerCenter(fromPos, fromVisual, m, W, H);
      var targetCorner = cornerCenter(targetPos, targetVisual, m, W, H);
      var posT = Math.min(morphT * 2, 1);
      var wrapCx = lerp(fromCorner.cx, targetCorner.cx, posT);
      var wrapCy = lerp(fromCorner.cy, targetCorner.cy, posT);

      // 8. Apply wrap CSS.
      var wrapHalf = cfg.wrapSize / 2;
      state.wrap.style.left = (wrapCx - wrapHalf) + 'px';
      state.wrap.style.top = (wrapCy - wrapHalf) + 'px';
      state.wrap.style.transform = 'scale(' + scaleAtT + ')';
      state.wrap.style.opacity = String(wrapOpacity);

      // 9. SVG vars.
      state.svg.style.setProperty('--t', String(svgT));
      state.svg.style.setProperty('--v', String(v));

      // 10. Webcam frame swap. Decode on the hidden <img> first so the
      //     subsequent SVG <image> href set hits the browser cache. Both
      //     webcam-back and webcam-front reference the same URL.
      if (cfg.hasWebcam) {
        var url = cfg.frameUrlBase + frameIdx + '.jpg';
        state.preloadImg.src = url;
        return state.preloadImg.decode().then(function () {
          state.webcamFront.setAttribute('href', url);
          state.webcamBack.setAttribute('href', url);
        }).catch(function () {
          // Decode errors keep the previous frame visible — non-fatal.
        });
      }
      return Promise.resolve();
    },
  };
})();
`;

/**
 * Set up the page-side overlay: register the frame route handler, install the
 * page-side overlay code, and prime per-frame driver state.
 */
export async function injectOverlay(
  page: Page,
  options: InjectOverlayOptions,
  frames: Buffer[] | null,
): Promise<void> {
  const { spec, hasWebcam, amplitudeSamples, fps, zoom } = options;

  // Frame route handler: serve frame_{N}.jpg from the in-memory bundle. The
  // frame index is parsed from the URL path. Out-of-range indices clamp to
  // the last frame so the overlay stays visually stable rather than
  // showing a broken image at the very tail.
  if (hasWebcam && frames && frames.length > 0) {
    const FRAME_RE = /frame_(\d+)\.jpg$/;
    const lastFrame = frames.length - 1;
    await page.route(`${WEBCAM_FRAME_URL_BASE}*.jpg`, async (route) => {
      const m = route.request().url().match(FRAME_RE);
      if (!m) {
        await route.abort();
        return;
      }
      const idx = Math.min(lastFrame, Math.max(0, parseInt(m[1], 10)));
      await route.fulfill({
        status: 200,
        contentType: "image/jpeg",
        body: frames[idx],
      });
    });
  }

  // CSS-pixel sizes (virtual / zoom). The wrap is sized so SVG viewBox r=200
  // maps to R_css. Throb halo at v=1 reaches 1.236 * R_css from center —
  // fits inside the wrap_half = 1.28 * R_css with margin to spare.
  const R_css = WEBCAM_OVERLAY_DIAMETER / 2 / zoom;
  const r_css = AUDIO_OVERLAY_DIAMETER / 2 / zoom;
  const PAD = WEBCAM_OVERLAY_MARGIN / zoom;
  const wrapSize = (256 / 200) * 2 * R_css; // = 2.56 * R_css

  // Install the overlay code as a string — bypasses esbuild function
  // serialisation that adds __name() helpers (not present in the page).
  await page.evaluate(OVERLAY_INSTALL_SCRIPT);

  const cfg = {
    frameUrlBase: WEBCAM_FRAME_URL_BASE,
    hasWebcam: hasWebcam && !!frames && frames.length > 0,
    R_css,
    r_css,
    PAD,
    wrapSize,
    borderColor: WEBCAM_BORDER_COLOR,
    micPath: MIC_PATH,
    // Throb modulation depth: r-throb = base * (1 + throbModulation * v).
    // Derived from AUDIO_THROB_MAX_SCALE (the multiplier at v = 1).
    throbModulation: AUDIO_THROB_MAX_SCALE - 1,
    spec,
    amplitude: amplitudeSamples,
    fps,
    totalFrames: options.totalFrames,
  };

  const cfgJson = JSON.stringify(cfg).replace(/</g, "\\u003c");
  await page.evaluate(`window.__vlad_overlay__.setup(${cfgJson});`);
}

/**
 * Drive the overlay forward by one frame. Function form ensures Playwright
 * awaits the page-side Promise (the preload image decode), guaranteeing the
 * next screenshot captures the loaded frame.
 */
export async function tickOverlay(page: Page, frameIdx: number): Promise<void> {
  await page.evaluate(
    (idx) => (window as unknown as { __vlad_overlay__: { tick: (n: number) => Promise<void> } }).__vlad_overlay__.tick(idx),
    frameIdx,
  );
}
