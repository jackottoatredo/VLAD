import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { uploadToR2 } from "@/lib/storage/r2";
import { FFMPEG_BIN } from "@/lib/render/ffmpeg-bin";
import type { Webcam, ThrobSpec } from "@/lib/render/spec";
import {
  WEBCAM_OVERLAY_DIAMETER,
  AUDIO_OVERLAY_DIAMETER,
  AUDIO_THROB_MAX_SCALE,
  WEBCAM_OVERLAY_MARGIN,
  WEBCAM_BORDER_COLOR,
  VIRTUAL_PREVIEW_SCALE_FACTOR,
} from "@/app/config";

/**
 * URL prefixes the page-side SVG <image> elements load from. Two prefixes
 * — one per section — let a single page.route handler per prefix fulfil
 * frames from the right webcam bundle.
 */
export const UNIFIED_INTRO_FRAME_URL_BASE = "https://__vlad_overlay__/intro/frame_";
export const UNIFIED_PRODUCT_FRAME_URL_BASE = "https://__vlad_overlay__/product/frame_";

/** Mic SVG path — keep in sync with the canonical public/audio-icon.svg
 *  (also duplicated in lib/render/overlay.ts for the single-section path).
 *  If the design changes, update both. */
const MIC_PATH =
  "M227.454 212.591C222.452 205.138 217.773 197.033 217.773 187.296C217.773 166.515 234.446 149.706 254.938 149.815C275.43 149.706 292.103 166.515 292.103 187.296C292.103 197.033 287.424 205.138 282.422 212.591C277.796 219.554 273.924 224.722 270.159 230.542C265.049 238.865 261.392 246.372 261.392 256.001C261.392 265.629 264.996 273.843 270.159 281.459C273.547 287.28 277.796 292.448 282.422 299.41C287.424 306.863 292.103 314.968 292.103 324.706C292.103 345.485 275.43 362.295 254.938 362.185C234.446 362.295 217.773 345.485 217.773 324.706C217.773 314.968 222.452 306.863 227.454 299.41C232.08 292.448 236.329 287.28 239.717 281.459C244.881 273.843 248.484 265.629 248.484 256.001C248.484 246.372 244.827 238.865 239.717 230.542C235.952 224.722 232.08 219.554 227.454 212.591Z";

/**
 * Page-side install script for the UNIFIED merge overlay. Conceptually
 * mirrors lib/render/overlay.ts:OVERLAY_INSTALL_SCRIPT but with merge-aware
 * semantics:
 *
 *   - tick(F) is driven by OUTPUT frame index F (over the full merged
 *     duration), not per-section frame index.
 *   - The morph window is centered at the merge boundary, [B − D/2, B + D/2].
 *   - Two SVG <image> elements: front loads from intro/frame_*, back from
 *     product/frame_*. The opacity blend (front-op = 1 − collapse, back-op
 *     = expand) drives the visible content swap. Both hrefs update per
 *     frame to track each section's session-time webcam frame.
 *   - Throb amplitude source switches at the boundary (intro track for
 *     F < B, product track for F ≥ B). The switch is invisible because at
 *     B the morph is at its pinch (everything is tiny / faded out).
 */
const UNIFIED_OVERLAY_INSTALL_SCRIPT = `
(function () {
  if (window.__vlad_overlay_unified__) return;

  // Inverted-parabola velocity: 80% cubic + 20% linear. Min velocity ~0.2x
  // at the pinch (no full freeze), peaks ~2.6x at the endpoints. Matches
  // the single-section overlay's curve.
  function springT(linearT) {
    var lt = Math.max(0, Math.min(1, linearT));
    var cubic = 4 * Math.pow(lt - 0.5, 3) + 0.5;
    return 0.8 * cubic + 0.2 * lt;
  }

  function rSvg(t) {
    var tc = Math.max(0, Math.min(1, t));
    var collapse = Math.min(tc * 2, 1);
    var expand = Math.max(0, tc * 2 - 1);
    return 200 - 193 * collapse + 93 * expand;
  }

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

  // ---------------------------------------------------------------------
  // SVG content builder. The same parameterised SVG (audio-icon) is used
  // for both the single-wrap (animated) and two-wrap (crossfade) modes.
  // The wrap div is sized so SVG viewBox r=200 maps to R_css.
  // ---------------------------------------------------------------------
  function buildWrap(cfg, idSuffix) {
    var wrap = document.createElement('div');
    wrap.id = '__vlad_overlay_wrap_' + idSuffix + '__';
    wrap.style.cssText =
      'position:absolute;width:' + cfg.wrapSize + 'px;height:' + cfg.wrapSize + 'px;' +
      'left:0;top:0;opacity:0;transform-origin:50% 50%;will-change:transform,opacity,left,top;';

    // clipPath ID needs to be unique per wrap (otherwise both wraps would
    // share the same clipPath id in the document, causing url(#id) lookups
    // to be ambiguous).
    var clipId = '__vlad_webcam_clip_' + idSuffix + '__';

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
          '<clipPath id="' + clipId + '">' +
            '<circle cx="256" cy="256" style="r:var(--r);"></circle>' +
          '</clipPath>' +
        '</defs>' +
        '<image class="__vlad_webcam_back__" href="" x="56" y="56" width="400" height="400" ' +
          'preserveAspectRatio="xMidYMid slice" clip-path="url(#' + clipId + ')" ' +
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
        '<image class="__vlad_webcam_front__" href="" x="56" y="56" width="400" height="400" ' +
          'preserveAspectRatio="xMidYMid slice" clip-path="url(#' + clipId + ')" ' +
          'style="opacity:var(--front-op);"></image>' +
        '<circle cx="256" cy="256" style="r:var(--r);fill:none;opacity:var(--front-op);" ' +
          'stroke="' + cfg.borderColor + '" stroke-width="12"></circle>' +
      '</svg>'
    );

    var preload = document.createElement('img');
    preload.style.cssText = 'display:none;';
    preload.alt = '';

    return {
      wrap: wrap,
      svg: wrap.querySelector('svg'),
      webcamFront: wrap.querySelector('.__vlad_webcam_front__'),
      webcamBack: wrap.querySelector('.__vlad_webcam_back__'),
      preload: preload,
    };
  }

  function visualOuterFor(cfg, t) {
    var tc = Math.max(0, Math.min(1, t));
    return cfg.R_css * (rSvg(tc) / 200) * lerp(1, 2 * cfg.r_css / cfg.R_css, tc);
  }

  // ---------------------------------------------------------------------
  // tickAnimated: single-wrap path. The wrap moves between corners as
  // position lerps; --t lerps from intro to product mode (no-op when
  // modes match). Webcam content always loads from the current section
  // (intro pre-boundary, product post-boundary). The boundary content
  // cut is hidden by the pinch (mode-changing morphs) or the mic-group's
  // black bg (audio→audio).
  // ---------------------------------------------------------------------
  function tickAnimated(F, state, morphT) {
    var cfg = state.cfg;
    var fps = cfg.fps;
    var frameDurMs = 1000 / fps;
    var W = window.innerWidth;
    var H = window.innerHeight;
    var boundaryFrameIdx = cfg.boundaryFrameIdx;
    var introWebcam = cfg.introWebcam;
    var productWebcam = cfg.productWebcam;

    var fromTVal = modeT(introWebcam.mode);
    var targetTVal = modeT(productWebcam.mode);
    var svgT;
    if (fromTVal !== null && targetTVal !== null) {
      svgT = springT(lerp(fromTVal, targetTVal, morphT));
    } else if (targetTVal !== null) {
      svgT = targetTVal;
    } else if (fromTVal !== null) {
      svgT = fromTVal;
    } else {
      svgT = 0;
    }

    var fromAlpha = (introWebcam.mode === 'off') ? 0 : 1;
    var targetAlpha = (productWebcam.mode === 'off') ? 0 : 1;
    var wrapOpacity = lerp(fromAlpha, targetAlpha, morphT);

    var v = 0;
    if (F < boundaryFrameIdx) {
      if (cfg.introThrobEnabled && cfg.introAmplitude && cfg.introAmplitude.length > 0) {
        var introSessionMs = (cfg.introTrimStartSec * 1000) + F * frameDurMs;
        var introAmpIdx = Math.max(0, Math.min(cfg.introAmplitude.length - 1, Math.round(introSessionMs / frameDurMs)));
        v = cfg.introAmplitude[introAmpIdx] || 0;
      }
    } else {
      if (cfg.productThrobEnabled && cfg.productAmplitude && cfg.productAmplitude.length > 0) {
        var productSessionMs = (cfg.productTrimStartSec * 1000) + (F - boundaryFrameIdx) * frameDurMs;
        var productAmpIdx = Math.max(0, Math.min(cfg.productAmplitude.length - 1, Math.round(productSessionMs / frameDurMs)));
        v = cfg.productAmplitude[productAmpIdx] || 0;
      }
    }

    var R = cfg.R_css;
    var r = cfg.r_css;
    var svgTClamped = Math.max(0, Math.min(1, svgT));
    var scaleAtT = lerp(1, 2 * r / R, svgTClamped);

    var fromVisual = visualOuterFor(cfg, fromTVal !== null ? fromTVal : svgT);
    var targetVisual = visualOuterFor(cfg, targetTVal !== null ? targetTVal : svgT);
    var fromCorner = cornerCenter(introWebcam.position, fromVisual, cfg.PAD, W, H);
    var targetCorner = cornerCenter(productWebcam.position, targetVisual, cfg.PAD, W, H);
    var posT = Math.min(morphT * 2, 1);
    var wrapCx = lerp(fromCorner.cx, targetCorner.cx, posT);
    var wrapCy = lerp(fromCorner.cy, targetCorner.cy, posT);

    var wrapHalf = cfg.wrapSize / 2;
    state.wrap.style.left = (wrapCx - wrapHalf) + 'px';
    state.wrap.style.top = (wrapCy - wrapHalf) + 'px';
    state.wrap.style.transform = 'scale(' + scaleAtT + ')';
    state.wrap.style.opacity = String(wrapOpacity);

    state.svg.style.setProperty('--t', String(svgT));
    state.svg.style.setProperty('--v', String(v));

    var inIntro = F < boundaryFrameIdx;
    var url = null;
    if (inIntro && cfg.hasIntroFrames) {
      var introFrameIdx = Math.max(0, Math.min(
        cfg.introFrameCount - 1,
        Math.round(((cfg.introTrimStartSec * 1000) + F * frameDurMs) / frameDurMs)
      ));
      url = cfg.introFrameUrlBase + introFrameIdx + '.jpg';
    } else if (!inIntro && cfg.hasProductFrames) {
      var productFrameIdx = Math.max(0, Math.min(
        cfg.productFrameCount - 1,
        Math.round(((cfg.productTrimStartSec * 1000) + (F - boundaryFrameIdx) * frameDurMs) / frameDurMs)
      ));
      url = cfg.productFrameUrlBase + productFrameIdx + '.jpg';
    }
    if (url !== null) {
      state.preloadFront.src = url;
      var loadedUrl = url;
      return state.preloadFront.decode().then(function () {
        state.webcamFront.setAttribute('href', loadedUrl);
        state.webcamBack.setAttribute('href', loadedUrl);
      }).catch(function () { /* keep last frame */ });
    }
    return Promise.resolve();
  }

  // ---------------------------------------------------------------------
  // tickCrossfade: two-wrap path. Each wrap is fixed at its section's
  // corner+mode (--t locked at setup). Per-frame work is wrap opacity
  // (sectionT crossfade × mode alpha), per-section --v throb, and webcam
  // href swap. Intro frames clamp to the boundary frame after F ≥ B
  // (intro is invisible there); product frames sit at session-time 0 for
  // F < B (product is invisible there).
  // ---------------------------------------------------------------------
  function tickCrossfade(F, state, morphT) {
    var cfg = state.cfg;
    var fps = cfg.fps;
    var frameDurMs = 1000 / fps;
    var boundaryFrameIdx = cfg.boundaryFrameIdx;

    state.wIntro.wrap.style.opacity = String((1 - morphT) * state.introModeAlpha);
    state.wProduct.wrap.style.opacity = String(morphT * state.productModeAlpha);

    var introSessionMs = (cfg.introTrimStartSec * 1000) + Math.min(F, boundaryFrameIdx) * frameDurMs;
    var productSessionMs = (cfg.productTrimStartSec * 1000) + Math.max(0, F - boundaryFrameIdx) * frameDurMs;

    var vIntro = 0;
    if (cfg.introThrobEnabled && cfg.introAmplitude && cfg.introAmplitude.length > 0) {
      var iIdx = Math.max(0, Math.min(cfg.introAmplitude.length - 1, Math.round(introSessionMs / frameDurMs)));
      vIntro = cfg.introAmplitude[iIdx] || 0;
    }
    var vProduct = 0;
    if (cfg.productThrobEnabled && cfg.productAmplitude && cfg.productAmplitude.length > 0) {
      var pIdx = Math.max(0, Math.min(cfg.productAmplitude.length - 1, Math.round(productSessionMs / frameDurMs)));
      vProduct = cfg.productAmplitude[pIdx] || 0;
    }
    state.wIntro.svg.style.setProperty('--v', String(vIntro));
    state.wProduct.svg.style.setProperty('--v', String(vProduct));

    var promises = [];
    if (cfg.hasIntroFrames) {
      var introFrameIdx = Math.max(0, Math.min(
        cfg.introFrameCount - 1,
        Math.round(introSessionMs / frameDurMs)
      ));
      var introUrl = cfg.introFrameUrlBase + introFrameIdx + '.jpg';
      state.wIntro.preload.src = introUrl;
      promises.push(state.wIntro.preload.decode().then(function () {
        state.wIntro.webcamFront.setAttribute('href', introUrl);
      }).catch(function () { /* keep last frame */ }));
    }
    if (cfg.hasProductFrames) {
      var productFrameIdx = Math.max(0, Math.min(
        cfg.productFrameCount - 1,
        Math.round(productSessionMs / frameDurMs)
      ));
      var productUrl = cfg.productFrameUrlBase + productFrameIdx + '.jpg';
      state.wProduct.preload.src = productUrl;
      promises.push(state.wProduct.preload.decode().then(function () {
        state.wProduct.webcamFront.setAttribute('href', productUrl);
      }).catch(function () { /* keep last frame */ }));
    }
    return Promise.all(promises);
  }

  window.__vlad_overlay_unified__ = {
    setup: function (cfg) {
      if (document.getElementById('__vlad_overlay_root__')) return;

      var root = document.createElement('div');
      root.id = '__vlad_overlay_root__';
      root.style.cssText =
        'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646;';

      var state = { cfg: cfg, kind: cfg.transitionKind };

      if (cfg.transitionKind === 'crossfade') {
        // Two-wrap: each section gets its own wrap pinned at its corner
        // and locked at its mode (--t fixed). Per-frame work is just the
        // wrap opacity (sectionT crossfade), --v throb, and webcam href.
        var wIntro = buildWrap(cfg, 'intro');
        var wProduct = buildWrap(cfg, 'product');

        var W = window.innerWidth;
        var H = window.innerHeight;
        var wrapHalf = cfg.wrapSize / 2;

        var introTVal = modeT(cfg.introWebcam.mode);
        var productTVal = modeT(cfg.productWebcam.mode);
        // 'off' modes don't have a t — render at video state and hide via opacity.
        var introT = introTVal !== null ? introTVal : 0;
        var productT = productTVal !== null ? productTVal : 0;

        var introVisual = visualOuterFor(cfg, introT);
        var productVisual = visualOuterFor(cfg, productT);
        var introCorner = cornerCenter(cfg.introWebcam.position, introVisual, cfg.PAD, W, H);
        var productCorner = cornerCenter(cfg.productWebcam.position, productVisual, cfg.PAD, W, H);
        var introScale = lerp(1, 2 * cfg.r_css / cfg.R_css, introT);
        var productScale = lerp(1, 2 * cfg.r_css / cfg.R_css, productT);

        wIntro.wrap.style.left = (introCorner.cx - wrapHalf) + 'px';
        wIntro.wrap.style.top = (introCorner.cy - wrapHalf) + 'px';
        wIntro.wrap.style.transform = 'scale(' + introScale + ')';
        wIntro.svg.style.setProperty('--t', String(introT));
        // Hide back image (the mic-group is the audio-state visual).
        wIntro.webcamBack.style.opacity = '0';

        wProduct.wrap.style.left = (productCorner.cx - wrapHalf) + 'px';
        wProduct.wrap.style.top = (productCorner.cy - wrapHalf) + 'px';
        wProduct.wrap.style.transform = 'scale(' + productScale + ')';
        wProduct.svg.style.setProperty('--t', String(productT));
        wProduct.webcamBack.style.opacity = '0';

        // Section-mode alpha: 0 when 'off', 1 otherwise. Multiplied with
        // sectionT-driven crossfade alpha so 'off' sides stay invisible.
        var introModeAlpha = cfg.introWebcam.mode === 'off' ? 0 : 1;
        var productModeAlpha = cfg.productWebcam.mode === 'off' ? 0 : 1;

        root.appendChild(wIntro.wrap);
        root.appendChild(wProduct.wrap);
        root.appendChild(wIntro.preload);
        root.appendChild(wProduct.preload);
        document.body.appendChild(root);

        state.wIntro = wIntro;
        state.wProduct = wProduct;
        state.introT = introT;
        state.productT = productT;
        state.introModeAlpha = introModeAlpha;
        state.productModeAlpha = productModeAlpha;
      } else {
        // Single-wrap (animated, including the morphDurationMs=0 'none' case).
        var w = buildWrap(cfg, 'unified');
        root.appendChild(w.wrap);
        root.appendChild(w.preload);
        document.body.appendChild(root);

        state.wrap = w.wrap;
        state.svg = w.svg;
        state.webcamFront = w.webcamFront;
        state.webcamBack = w.webcamBack;
        state.preloadFront = w.preload;
        // Hide back image once at setup. Front's opacity stays var(--front-op).
        w.webcamBack.style.opacity = '0';
      }

      window.__vlad_overlay_unified_state__ = state;
    },

    tick: function (F) {
      var state = window.__vlad_overlay_unified_state__;
      if (!state) return Promise.resolve();
      var cfg = state.cfg;
      var fps = cfg.fps;
      var boundaryFrameIdx = cfg.boundaryFrameIdx;

      // morphT — same window math for both transition kinds.
      var morphHalf = Math.max(0, Math.round(cfg.morphDurationMs / 1000 * fps / 2));
      var morphStart = boundaryFrameIdx - morphHalf;
      var morphEnd = boundaryFrameIdx + morphHalf;
      var morphT;
      if (morphHalf === 0) {
        morphT = F < boundaryFrameIdx ? 0 : 1;
      } else if (F <= morphStart) {
        morphT = 0;
      } else if (F >= morphEnd) {
        morphT = 1;
      } else {
        morphT = (F - morphStart) / (morphEnd - morphStart);
      }

      if (state.kind === 'crossfade') {
        return tickCrossfade(F, state, morphT);
      }
      return tickAnimated(F, state, morphT);
    },
  };
})();
`;

export type UnifiedOverlayInputs = {
  // Identity / output
  userId: string;
  sessionName: string;

  // Output canvas + timing
  width: number; // virtual px (== section render width — both sections must match)
  height: number;
  zoom: number;
  fps: number;

  /** Total output frame count over the merged duration. */
  totalOutputFrames: number;
  /** Output frame index where intro ends and product begins. */
  boundaryFrameIdx: number;

  // Intro-side
  introWebcam: Webcam;
  introThrob?: ThrobSpec;
  introFrames: Buffer[] | null;
  introAmplitudeSamples: number[] | null;
  /** intro recording's trim start in seconds — anchors the session-time
   *  → frame-index mapping for intro webcam frame lookup. */
  introTrimStartSec: number;

  // Product-side
  productWebcam: Webcam;
  productThrob?: ThrobSpec;
  productFrames: Buffer[] | null;
  productAmplitudeSamples: number[] | null;
  productTrimStartSec: number;

  /** Merge-level morph / crossfade window length (ms). Centered at the
   *  merge boundary: [B − D/2, B + D/2]. 0 → hard cut at the boundary
   *  (only meaningful for 'animated' kind; 'crossfade' with 0 is a hard
   *  cut too). */
  morphDurationMs: number;
  /** Transition kind:
   *    - 'animated':  one wrap. Position lerps between corners, --t lerps
   *                   between section modes (no-op when modes match).
   *                   Use morphDurationMs=0 for the 'none' (hard cut) case.
   *    - 'crossfade': two wraps. Each fixed at its section's corner+state.
   *                   Their alphas crossfade over the morph window. */
  transitionKind: "animated" | "crossfade";

  preview?: boolean;
  onProgress?: (rendered: number, total: number) => void;
};

export type UnifiedOverlayResult = {
  videoUrl: string;
  outputPath: string;
  totalDurationMs: number;
};

export async function renderUnifiedMergeOverlay(
  options: UnifiedOverlayInputs,
): Promise<UnifiedOverlayResult> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "videobot-uov-"));
  const framesDir = path.join(tempDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const fileName = `${options.sessionName}-uov-${Date.now()}-${randomUUID().slice(0, 8)}.mov`;
  const outputPath = path.join(tempDir, fileName);
  const r2Key = `renders/${options.userId}/${options.sessionName}/${fileName}`;

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const vw = options.width;
    const vh = options.height;
    const zoom = options.zoom ?? 1;
    const dpr = options.preview ? zoom * VIRTUAL_PREVIEW_SCALE_FACTOR : zoom;

    const context = await browser.newContext({
      viewport: { width: Math.round(vw / zoom), height: Math.round(vh / zoom) },
      deviceScaleFactor: dpr,
    });
    const page = await context.newPage();

    // Two prefixed routes. Each fulfils from its own buffer. Out-of-range
    // indices clamp to the last frame for stability.
    const FRAME_RE = /frame_(\d+)\.jpg$/;
    if (options.introFrames && options.introFrames.length > 0) {
      const introFrames = options.introFrames;
      const lastIntro = introFrames.length - 1;
      await page.route(`${UNIFIED_INTRO_FRAME_URL_BASE}*.jpg`, async (route) => {
        const m = route.request().url().match(FRAME_RE);
        if (!m) {
          await route.abort();
          return;
        }
        const idx = Math.min(lastIntro, Math.max(0, parseInt(m[1], 10)));
        await route.fulfill({ status: 200, contentType: "image/jpeg", body: introFrames[idx] });
      });
    }
    if (options.productFrames && options.productFrames.length > 0) {
      const productFrames = options.productFrames;
      const lastProduct = productFrames.length - 1;
      await page.route(`${UNIFIED_PRODUCT_FRAME_URL_BASE}*.jpg`, async (route) => {
        const m = route.request().url().match(FRAME_RE);
        if (!m) {
          await route.abort();
          return;
        }
        const idx = Math.min(lastProduct, Math.max(0, parseInt(m[1], 10)));
        await route.fulfill({ status: 200, contentType: "image/jpeg", body: productFrames[idx] });
      });
    }

    await page.goto("about:blank", { timeout: 10_000 });
    await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      root.style.background = "transparent";
      root.style.margin = "0";
      body.style.background = "transparent";
      body.style.margin = "0";
    });

    const R_css = WEBCAM_OVERLAY_DIAMETER / 2 / zoom;
    const r_css = AUDIO_OVERLAY_DIAMETER / 2 / zoom;
    const PAD = WEBCAM_OVERLAY_MARGIN / zoom;
    const wrapSize = (256 / 200) * 2 * R_css;

    await page.evaluate(UNIFIED_OVERLAY_INSTALL_SCRIPT);

    const cfg = {
      // Geometry
      R_css,
      r_css,
      PAD,
      wrapSize,
      borderColor: WEBCAM_BORDER_COLOR,
      micPath: MIC_PATH,
      // Throb modulation depth: r-throb = base * (1 + throbModulation * v).
      // Derived from AUDIO_THROB_MAX_SCALE (the multiplier at v = 1).
      throbModulation: AUDIO_THROB_MAX_SCALE - 1,
      fps: options.fps,

      // Timing
      boundaryFrameIdx: options.boundaryFrameIdx,
      morphDurationMs: options.morphDurationMs,
      transitionKind: options.transitionKind,

      // Intro
      introWebcam: options.introWebcam,
      introThrobEnabled: !!options.introThrob && options.introThrob.enabled,
      introAmplitude: options.introAmplitudeSamples ?? null,
      introTrimStartSec: options.introTrimStartSec,
      introFrameUrlBase: UNIFIED_INTRO_FRAME_URL_BASE,
      hasIntroFrames: !!options.introFrames && options.introFrames.length > 0,
      introFrameCount: options.introFrames?.length ?? 0,

      // Product
      productWebcam: options.productWebcam,
      productThrobEnabled: !!options.productThrob && options.productThrob.enabled,
      productAmplitude: options.productAmplitudeSamples ?? null,
      productTrimStartSec: options.productTrimStartSec,
      productFrameUrlBase: UNIFIED_PRODUCT_FRAME_URL_BASE,
      hasProductFrames: !!options.productFrames && options.productFrames.length > 0,
      productFrameCount: options.productFrames?.length ?? 0,
    };

    const cfgJson = JSON.stringify(cfg).replace(/</g, "\\u003c");
    await page.evaluate(`window.__vlad_overlay_unified__.setup(${cfgJson});`);

    for (let i = 0; i < options.totalOutputFrames; i++) {
      await page.evaluate(
        (idx) =>
          (window as unknown as {
            __vlad_overlay_unified__: { tick: (n: number) => Promise<unknown> };
          }).__vlad_overlay_unified__.tick(idx),
        i,
      );
      const framePath = path.join(
        framesDir,
        `frame_${String(i + 1).padStart(6, "0")}.png`,
      );
      await page.screenshot({ path: framePath, type: "png", omitBackground: true });
      options.onProgress?.(i + 1, options.totalOutputFrames);
    }

    await encodeAlphaMov(framesDir, outputPath, options.fps);

    const buffer = await readFile(outputPath);
    await uploadToR2(r2Key, buffer, "video/quicktime");

    return {
      videoUrl: r2Key,
      outputPath,
      totalDurationMs: Math.round((options.totalOutputFrames / options.fps) * 1000),
    };
  } finally {
    await browser.close();
    await rm(framesDir, { recursive: true, force: true });
  }
}

async function encodeAlphaMov(
  framesDir: string,
  outputPath: string,
  fps: number,
): Promise<void> {
  const args = [
    "-framerate", String(fps),
    "-i", path.join(framesDir, "frame_%06d.png"),
    "-c:v", "png",
    "-pix_fmt", "rgba",
    "-y",
    outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args);
    const stderrLines: string[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrLines.push(chunk.toString());
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg unified-overlay encode exited with code ${code}:\n${stderrLines.join("")}`));
    });
    proc.on("error", reject);
  });
}
