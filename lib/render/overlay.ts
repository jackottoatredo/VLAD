import { readFile } from "node:fs/promises";
import { type Page } from "playwright";
import type { RenderSpec } from "@/lib/render/spec";
import {
  WEBCAM_OVERLAY_DIAMETER,
  WEBCAM_OVERLAY_MARGIN,
  WEBCAM_BORDER_THICKNESS,
  WEBCAM_BORDER_COLOR,
} from "@/app/config";

/**
 * URL the page-side overlay loads for the webcam video. Intercepted by
 * Playwright's page.route and fulfilled with the local webcam buffer.
 */
export const WEBCAM_FAKE_URL = "https://__vlad_overlay__/webcam.webm";

export type InjectOverlayOptions = {
  spec: RenderSpec;
  /** Local fs path to webcam.webm (downloaded by caller). Null when no webcam. */
  webcamPath: string | null;
  /** Pre-baked amplitude samples [0,1], one per video frame at `fps`. Null when no audio data. */
  amplitudeSamples: number[] | null;
  /** Render fps — used to compute per-frame morph/throb progress. */
  fps: number;
  /** Render zoom factor — overlay sizes are virtual-px / zoom = CSS-px. */
  zoom: number;
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
      var video = document.createElement('video');
      video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      if (cfg.hasWebcam) {
        video.src = cfg.webcamUrl;
        video.load();
      }
      videoWrap.appendChild(video);

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
        videoWrap: videoWrap,
        audioWrap: audioWrap,
        video: video,
      };
    },

    tick: function (frameIdx) {
      var state = window.__vlad_overlay_state__;
      if (!state) return Promise.resolve();

      var spec = state.spec;
      var fps = state.fps;
      var plateSize = state.plateSize;
      var PAD = state.PAD;

      var fromMode = spec.morph ? spec.morph.fromMode : spec.webcam.mode;
      var targetMode = spec.webcam.mode;
      var fromPos = spec.morph ? spec.morph.fromPosition : spec.webcam.position;
      var targetPos = spec.webcam.position;

      var morphT = 1;
      if (spec.morph) {
        var elapsedMs = frameIdx * (1000 / fps);
        morphT = Math.max(0, Math.min(elapsedMs / spec.morph.durationMs, 1));
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

      // Sync video.currentTime — return a promise the caller awaits before screenshot.
      var video = state.video;
      if (video && video.src) {
        var targetTime = frameIdx / fps;
        var dur = isFinite(video.duration) ? video.duration : Infinity;
        var t = targetTime;
        var maxT = dur - 0.001;
        if (maxT < 0) maxT = 0;
        if (t > maxT) t = maxT;

        if (Math.abs(video.currentTime - t) > 0.5 / fps) {
          return new Promise(function (resolve) {
            var resolved = false;
            var onEnd = function () {
              if (resolved) return;
              resolved = true;
              video.removeEventListener('seeked', onEnd);
              video.removeEventListener('error', onEnd);
              resolve();
            };
            video.addEventListener('seeked', onEnd);
            video.addEventListener('error', onEnd);
            setTimeout(onEnd, 250);
            try {
              video.currentTime = t;
            } catch (e) {
              onEnd();
            }
          });
        }
      }
      return Promise.resolve();
    },
  };
})();
`;

/**
 * Set up the page-side overlay: register the webcam asset interceptor, install
 * the page-side overlay code, and prime per-frame driver state.
 */
export async function injectOverlay(page: Page, options: InjectOverlayOptions): Promise<void> {
  const { spec, webcamPath, amplitudeSamples, fps, zoom } = options;

  if (webcamPath) {
    const buf = await readFile(webcamPath);
    await page.route(WEBCAM_FAKE_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "video/webm",
        body: buf,
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
    webcamUrl: WEBCAM_FAKE_URL,
    hasWebcam: !!webcamPath,
    D,
    B,
    PAD,
    plateSize,
    borderColor: WEBCAM_BORDER_COLOR,
    spec,
    amplitude: amplitudeSamples,
    fps,
  };

  // String-form evaluate — no closure to transpile, no __name calls inserted.
  // Encode `</` to avoid any chance of script-context confusion.
  const cfgJson = JSON.stringify(cfg).replace(/</g, "\\u003c");
  await page.evaluate(`window.__vlad_overlay__.setup(${cfgJson});`);
}

/**
 * Drive the overlay forward by one frame. Awaits the webcam seek so the next
 * screenshot captures the correct video frame.
 */
export async function tickOverlay(page: Page, frameIdx: number): Promise<void> {
  // String-form evaluate so the worker's bundler can't inject __name helpers.
  await page.evaluate(`window.__vlad_overlay__.tick(${frameIdx});`);
}
