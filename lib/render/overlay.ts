import { type Page } from "playwright";
import type { RenderSpec } from "@/lib/render/spec";
import {
  WEBCAM_OVERLAY_DIAMETER,
  WEBCAM_OVERLAY_MARGIN,
  WEBCAM_BORDER_THICKNESS,
  WEBCAM_BORDER_COLOR,
} from "@/app/config";

/**
 * Base URL the page-side overlay loads webcam frames from. Each frame is
 * fetched as `${WEBCAM_FRAME_URL_BASE}{N}.jpg` and intercepted by Playwright's
 * `page.route`, served from the in-memory frame bundle the worker resolved.
 *
 * Per-frame JPEGs replace the previous `<video>`+seek model: render is now
 * deterministic, no media-element clock to drift against the renderer's
 * frame counter.
 */
export const WEBCAM_FRAME_URL_BASE = "https://__vlad_overlay__/frame_";

export type InjectOverlayOptions = {
  spec: RenderSpec;
  /** True when frame data is available — tells the overlay to mount an `<img>`
   *  and load per-frame JPEGs. False = no webcam, audio-only or off. */
  hasWebcam: boolean;
  /** Pre-baked amplitude samples [0,1], one per video frame at `fps`. Null when no audio data. */
  amplitudeSamples: number[] | null;
  /** Render fps — used to compute per-frame morph/throb progress. */
  fps: number;
  /** Render zoom factor — overlay sizes are virtual-px / zoom = CSS-px. */
  zoom: number;
  /** Total number of capture frames in this section. Entry morph anchors at
   *  frame 0; exit morph anchors at `totalFrames`. The render is
   *  trim-agnostic — trim is applied as a separate post-render stage. */
  totalFrames: number;
};

/**
 * Page-side install script. Plain JavaScript IIFE — not transpiled by esbuild,
 * so it can't accumulate `__name` helper calls that would fail to resolve in
 * the browser context. Defines window.__vlad_overlay__ = { setup, tick }.
 *
 * Both methods are called from the worker via string-form page.evaluate
 * (see callers below) so the function bodies sent across the bridge are
 * never serialised through esbuild.
 */
const OVERLAY_INSTALL_SCRIPT = `
(function () {
  if (window.__vlad_overlay__) return;

  window.__vlad_overlay__ = {
    setup: function (cfg) {
      if (document.getElementById('__vlad_overlay_root__')) return;

      var root = document.createElement('div');
      root.id = '__vlad_overlay_root__';
      root.style.cssText =
        'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646;';

      var wrapStyle =
        'position:absolute;width:' + cfg.plateSize + 'px;height:' + cfg.plateSize + 'px;' +
        'border-radius:50%;box-sizing:border-box;border:' + cfg.B + 'px solid ' + cfg.borderColor + ';' +
        'overflow:hidden;background-color:#222;left:0;top:0;opacity:0;' +
        'transform-origin:50% 50%;will-change:transform,opacity,left,top;';

      var videoWrap = document.createElement('div');
      videoWrap.style.cssText = wrapStyle;
      // Per-frame webcam visual: an <img> swapped frame-by-frame from the
      // pre-extracted JPEG bundle. Replaces the previous <video>+seek model
      // — synchronous, deterministic, no clock drift.
      var img = document.createElement('img');
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      img.alt = '';
      img.draggable = false;
      videoWrap.appendChild(img);

      var audioWrap = document.createElement('div');
      audioWrap.style.cssText = wrapStyle;
      audioWrap.style.backgroundColor = '#282828';
      audioWrap.innerHTML =
        '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"' +
        ' style="width:100%;height:100%;display:block;">' +
        '<circle cx="50" cy="50" r="22" fill="#fff" opacity="0.85"></circle>' +
        '</svg>';

      root.appendChild(videoWrap);
      root.appendChild(audioWrap);
      document.body.appendChild(root);

      window.__vlad_overlay_state__ = {
        spec: cfg.spec,
        amplitude: cfg.amplitude,
        fps: cfg.fps,
        plateSize: cfg.plateSize,
        PAD: cfg.PAD,
        totalFrames: cfg.totalFrames,
        hasWebcam: cfg.hasWebcam,
        frameUrlBase: cfg.frameUrlBase,
        videoWrap: videoWrap,
        audioWrap: audioWrap,
        image: img,
      };
    },

    tick: function (frameIdx) {
      var state = window.__vlad_overlay_state__;
      if (!state) return Promise.resolve();

      var spec = state.spec;
      var fps = state.fps;
      var plateSize = state.plateSize;
      var PAD = state.PAD;
      var totalFrames = state.totalFrames;

      // Morph anchors to capture-frame indices: entry at frame 0, exit at
      // (totalFrames − D). Render is trim-agnostic — the post-render trim
      // sub-stage cuts a window from this output. Glides at the very start
      // / very end of the session may be trimmed off when trim doesn't
      // reach those edges; the trim-extension on crossfade flows aligns
      // trim with session boundaries when un-trimmed content is available.
      var fromMode = spec.webcam.mode;
      var targetMode = spec.webcam.mode;
      var fromPos = spec.webcam.position;
      var targetPos = spec.webcam.position;
      var morphT = 1;

      if (spec.morph) {
        // Entry morph: animates FROM (morph.fromMode/fromPos) TO (webcam)
        // over the first N capture frames.
        fromMode = spec.morph.fromMode;
        fromPos = spec.morph.fromPosition;
        var entryElapsedMs = frameIdx * (1000 / fps);
        morphT = Math.max(0, Math.min(entryElapsedMs / spec.morph.durationMs, 1));
      } else if (spec.exitMorph) {
        // Exit morph: animates FROM (webcam) TO (exitMorph.toMode/toPos)
        // over the last N capture frames.
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

      var throbScale = 1;
      if (spec.throb && spec.throb.enabled && state.amplitude && state.amplitude.length > 0) {
        var ampIdx = frameIdx;
        if (ampIdx > state.amplitude.length - 1) ampIdx = state.amplitude.length - 1;
        var amp = state.amplitude[ampIdx] || 0;
        throbScale = spec.throb.minScale + (spec.throb.maxScale - spec.throb.minScale) * amp;
      }

      var fromX = fromPos.horizontal === 'left' ? PAD : window.innerWidth - PAD - plateSize;
      var fromY = fromPos.vertical === 'top' ? PAD : window.innerHeight - PAD - plateSize;
      var toX = targetPos.horizontal === 'left' ? PAD : window.innerWidth - PAD - plateSize;
      var toY = targetPos.vertical === 'top' ? PAD : window.innerHeight - PAD - plateSize;
      var ptX = fromX + (toX - fromX) * morphT;
      var ptY = fromY + (toY - fromY) * morphT;

      // Video wrap
      var vIsFrom = fromMode === 'video';
      var vIsTarget = targetMode === 'video';
      var vOpacity = vIsFrom && vIsTarget ? 1 : vIsFrom ? 1 - morphT : vIsTarget ? morphT : 0;
      state.videoWrap.style.left = ptX + 'px';
      state.videoWrap.style.top = ptY + 'px';
      state.videoWrap.style.opacity = String(vOpacity);
      state.videoWrap.style.transform = '';

      // Audio wrap
      var aIsFrom = fromMode === 'audio';
      var aIsTarget = targetMode === 'audio';
      var aOpacity = aIsFrom && aIsTarget ? 1 : aIsFrom ? 1 - morphT : aIsTarget ? morphT : 0;
      state.audioWrap.style.left = ptX + 'px';
      state.audioWrap.style.top = ptY + 'px';
      state.audioWrap.style.opacity = String(aOpacity);
      if (aIsTarget && aOpacity > 0.01) {
        state.audioWrap.style.transform = 'scale(' + throbScale + ')';
      } else {
        state.audioWrap.style.transform = '';
      }

      // Per-frame webcam visual: swap the <img> src to the current frame's
      // JPEG and await decode so the screenshot captures the loaded image.
      // The page.evaluate caller awaits this returned Promise.
      if (state.hasWebcam && state.image) {
        state.image.src = state.frameUrlBase + frameIdx + '.jpg';
        return state.image.decode().catch(function () {
          // Decode errors are non-fatal — render proceeds with the previous
          // frame's image (or empty) rather than throwing the whole job.
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
  // frame index is parsed from the URL path. Out-of-range indices (rare —
  // happens at the very tail when capture frames slightly exceed bundle
  // count due to rounding) clamp to the last frame so the overlay stays
  // visually stable rather than showing a broken image.
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

  const D = WEBCAM_OVERLAY_DIAMETER / zoom;
  const B = WEBCAM_BORDER_THICKNESS / zoom;
  const PAD = WEBCAM_OVERLAY_MARGIN / zoom;
  const plateSize = D + 2 * B;

  // Install the overlay code as a string — bypasses esbuild function
  // serialisation that adds __name() helpers (which don't exist in the page).
  await page.evaluate(OVERLAY_INSTALL_SCRIPT);

  const cfg = {
    frameUrlBase: WEBCAM_FRAME_URL_BASE,
    hasWebcam: hasWebcam && !!frames && frames.length > 0,
    D,
    B,
    PAD,
    plateSize,
    borderColor: WEBCAM_BORDER_COLOR,
    spec,
    amplitude: amplitudeSamples,
    fps,
    totalFrames: options.totalFrames,
  };

  // String-form evaluate — no closure to transpile, no __name calls inserted.
  // Encode `</` to avoid any chance of script-context confusion.
  const cfgJson = JSON.stringify(cfg).replace(/</g, "\\u003c");
  await page.evaluate(`window.__vlad_overlay__.setup(${cfgJson});`);
}

/**
 * Drive the overlay forward by one frame. Function form ensures Playwright
 * awaits the page-side Promise (returned by `tick()` from `img.decode()`),
 * guaranteeing the next screenshot captures the loaded frame.
 */
export async function tickOverlay(page: Page, frameIdx: number): Promise<void> {
  await page.evaluate(
    (idx) => (window as unknown as { __vlad_overlay__: { tick: (n: number) => Promise<void> } }).__vlad_overlay__.tick(idx),
    frameIdx,
  );
}
