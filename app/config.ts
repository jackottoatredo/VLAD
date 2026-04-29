// export const TARGET_URL = "http://localhost:1111/";
export const TARGET_URL = "https://search.redo.com/record/"
export const MERCHANT_TARGET_URL = "https://search.redo.com/record"
export const VIRTUAL_WIDTH = 1920;
export const VIRTUAL_HEIGHT = 1080;
export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;
export const RENDER_ZOOM = 1.25;
export const DEFAULT_FPS = 30;

// Webcam overlay appearance — single source of truth for both the live preview (CSS, scaled
// by the iframe's scale factor) and the FFmpeg compositor (virtual pixel coordinates).
export const WEBCAM_OVERLAY_DIAMETER  = 350;  // circle diameter in virtual pixels
export const WEBCAM_OVERLAY_MARGIN    = 30;   // gap from the nearest edge to the circle center
export const WEBCAM_BORDER_THICKNESS  = 6;    // orange border ring width
export const WEBCAM_SHADOW_RADIUS     = 12;   // drop-shadow blur radius (controls spread)
export const WEBCAM_BORDER_COLOR      = "rgb(233, 77, 30)"; // CSS color string
export const WEBCAM_BORDER_COLOR_HEX  = "E94D1E";          // FFmpeg hex (no 0x prefix)
export const WEBCAM_RECORDER_TIMESLICE_MS = 100; // MediaRecorder chunk interval

// Preview render quality. MUST stay > 0.5 — Chromium clamps deviceScaleFactor there.
export const VIRTUAL_PREVIEW_SCALE_FACTOR = 0.5;
// FFmpeg post-render downscale divisor for preview output (integer >= 1).
export const PREVIEW_DOWNSCALE_FACTOR = 2;

// Product flow only: on "Continue to Post", eagerly enqueue the brandless render
// (priority 1) alongside the 3 branded preview renders (priority 2). Requires adequate
// WORKER_CONCURRENCY.
export const EAGER_PREVIEW_RENDERING = true;

// Brands shown on the product-flow Preview page (slots 1–3). Slot 4 is the brandless
// render reused from the postprocess step.
export const PREVIEW_BRANDS = ['allbirds.com', 'mammut.com', 'andcollar.com'] as const;
export type PreviewBrand = (typeof PREVIEW_BRANDS)[number];

// Live brand search page that the share-page "Explore interactive demo →" button opens.
export const INTERACTIVE_DEMO_BASE_URL = "https://redo.com/search/brands/";

// Marketing booking page linked from the share-page "Book a Demo" button.
export const BOOK_DEMO_URL = "https://redo.com/get-started/demo";

// Deployment environment flag. Set NEXT_PUBLIC_APP_ENV to "dev" | "beta" | "prod".
// Exposed to the client via the NEXT_PUBLIC_ prefix so UI can render env-aware labels.
export type AppEnv = "dev" | "beta" | "prod";
export const APP_ENV = (process.env.NEXT_PUBLIC_APP_ENV ?? "dev") as AppEnv;
export const PROD_URL = "https://vlad-production.up.railway.app/";
export const BETA_URL = "https://vlad-app-staged.up.railway.app/";
