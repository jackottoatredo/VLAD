// export const TARGET_URL = "http://localhost:1111/";
export const TARGET_URL = "http://search.redo.com/record/"
export const VIRTUAL_WIDTH = 1920;
export const VIRTUAL_HEIGHT = 1080;
export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;
export const RENDER_ZOOM = 1.25;
export const DEFAULT_FPS = 30;

// How many milliseconds to advance the webcam stream at composite time.
// The browser's MediaRecorder buffers the first chunk for ~timeslice ms before writing,
// so the webcam's first frame PTS is slightly later than t=0 of the screen recording.
// Increase this value if the webcam overlay is still missing from early frames.
export const WEBCAM_OFFSET_MS = 45;

// Webcam overlay appearance — single source of truth for both the live preview (CSS, scaled
// by the iframe's scale factor) and the FFmpeg compositor (virtual pixel coordinates).
export const WEBCAM_OVERLAY_DIAMETER  = 250;  // circle diameter in virtual pixels
export const WEBCAM_OVERLAY_PADDING   = 30;   // gap from bottom-left corner of the canvas
export const WEBCAM_BORDER_THICKNESS  = 6;    // orange border ring width
export const WEBCAM_SHADOW_RADIUS     = 12;   // drop-shadow blur radius (controls spread)
export const WEBCAM_BORDER_COLOR      = "rgb(233, 77, 30)"; // CSS color string
export const WEBCAM_BORDER_COLOR_HEX  = "E94D1E";          // FFmpeg hex (no 0x prefix)
export const WEBCAM_RECORDER_TIMESLICE_MS = 100; // MediaRecorder chunk interval
