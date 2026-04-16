import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { chromium, type Page } from "playwright";
import { type CursorPosition, type RenderAction } from "@/lib/render/actions";
import { installVirtualTimeClock, type VirtualTimeClock } from "@/lib/render/virtual-time";

export type RenderOptions = {
  url: string;
  presenter: string;
  sessionName: string;
  width: number;
  height: number;
  videoWidth?: number;
  videoHeight?: number;
  zoom?: number;
  fps: number;
  durationMs: number;
  actions?: RenderAction[];
  onProgress?: (rendered: number, total: number) => void;
};

export type RenderResult = {
  videoUrl: string;
  outputPath: string;
  totalDurationMs: number;
};

const CURSOR_ID = "__videobot_cursor__";
const RENDER_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CURSOR_FILE_PATH = path.join(process.cwd(), "public", "cursor.svg");
const CURSOR_SIZE_PX = 32;
const FFMPEG_FILENAME = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

function normalizeBundledRootPath(binaryPath: string): string {
  const rootPrefixPattern = /^([\\/])ROOT([\\/])/;

  if (!rootPrefixPattern.test(binaryPath)) {
    return binaryPath;
  }

  const relativePath = binaryPath
    .replace(rootPrefixPattern, "")
    .replace(/[\\/]/g, path.sep);

  return path.join(process.cwd(), relativePath);
}

function resolveFfmpegBinaryPath(): string | null {
  const candidates = [
    ffmpegPath,
    ffmpegPath ? normalizeBundledRootPath(ffmpegPath) : null,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", FFMPEG_FILENAME),
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveCursorSrc(): string {
  try {
    const svgContent = readFileSync(CURSOR_FILE_PATH, "utf8");
    const encoded = Buffer.from(svgContent, "utf8").toString("base64");
    return `data:image/svg+xml;base64,${encoded}`;
  } catch {
    return "/cursor.svg";
  }
}

export const resolvedFfmpegPath = resolveFfmpegBinaryPath();
const resolvedCursorSrc = resolveCursorSrc();

if (resolvedFfmpegPath) {
  ffmpeg.setFfmpegPath(resolvedFfmpegPath);
}

async function setCursorPosition(
  page: Page,
  cursorX: number,
  cursorY: number
): Promise<void> {
  await page.evaluate(
    ({ id, x, y, src, sizePx }) => {
      let cursor = document.getElementById(id);

      if (!cursor) {
        cursor = document.createElement("img");
        cursor.id = id;
        cursor.setAttribute("src", src);
        cursor.setAttribute("alt", "");
        cursor.setAttribute("aria-hidden", "true");
        cursor.style.position = "fixed";
        cursor.style.top = "0";
        cursor.style.left = "0";
        cursor.style.width = `${sizePx}px`;
        cursor.style.height = `${sizePx}px`;
        cursor.style.objectFit = "contain";
        cursor.style.zIndex = "2147483647";
        cursor.style.pointerEvents = "none";
        document.body.appendChild(cursor);
      }

      cursor.style.transform = `translate(${x}px, ${y}px)`;
    },
    { id: CURSOR_ID, x: cursorX, y: cursorY, src: resolvedCursorSrc, sizePx: CURSOR_SIZE_PX }
  );
}

async function renderFrames(
  page: Page,
  framesDir: string,
  options: RenderOptions,
  clock: VirtualTimeClock
): Promise<number> {
  const actions = options.actions ?? [];

  if (actions.length === 0) {
    throw new Error("No render actions were provided.");
  }

  const totalFrames = actions.reduce(
    (sum, action) => sum + Math.max(1, Math.round((action.durationMs / 1000) * options.fps)),
    0
  );

  const frameDurationMs = 1000 / options.fps;

  let renderedFrames = 0;
  let cursorBetweenActions: CursorPosition | undefined;

  for (const action of actions) {
    const frameCount = Math.max(1, Math.round((action.durationMs / 1000) * options.fps));

    cursorBetweenActions = await action.run({
      page,
      width: options.width,
      height: options.height,
      fps: options.fps,
      frameCount,
      startCursor: cursorBetweenActions,
      moveAndCapture: async (x, y) => {
        await clock.advance(frameDurationMs);

        await page.mouse.move(x, y, { steps: 1 });
        await setCursorPosition(page, x, y);

        renderedFrames += 1;
        options.onProgress?.(renderedFrames, totalFrames);

        const framePath = path.join(
          framesDir,
          `frame_${String(renderedFrames).padStart(4, "0")}.jpeg`
        );
        await page.screenshot({ path: framePath, type: "jpeg", quality: 80 });
      },
      advanceOnly: async () => {
        await clock.advance(frameDurationMs);
      },
    });
  }

  if (renderedFrames < 1) {
    throw new Error("No frames were rendered.");
  }

  return Math.round((renderedFrames / options.fps) * 1000);
}

async function encodeVideo(
  framesDir: string,
  outputPath: string,
  options: RenderOptions
): Promise<void> {
  if (!resolvedFfmpegPath) {
    throw new Error("Could not locate ffmpeg binary. Ensure ffmpeg-static is installed.");
  }

  await new Promise<void>((resolve, reject) => {
    ffmpeg(path.join(framesDir, "frame_%04d.jpeg"))
      .inputFPS(options.fps)
      .outputOptions([
        "-c:v libx264",
        "-pix_fmt yuv420p",
        "-movflags +faststart",
        `-t ${options.durationMs / 1000}`,
      ])
      .on("end", () => resolve())
      .on("error", (error: Error) => reject(error))
      .save(outputPath);
  });
}

async function cleanupOldRenders(dir: string, maxAgeMs: number): Promise<void> {
  const now = Date.now();

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".mp4"))
        .map(async (entry) => {
          const filePath = path.join(dir, entry.name);
          const fileStats = await stat(filePath);

          if (now - fileStats.mtimeMs > maxAgeMs) {
            await rm(filePath, { force: true });
          }
        })
    );
  } catch {
    // Best effort cleanup only.
  }
}

export async function renderUrlToMp4(options: RenderOptions): Promise<RenderResult> {
  const renderingsDir = path.join(process.cwd(), "public", "users", options.presenter, options.sessionName, "renderings");
  await mkdir(renderingsDir, { recursive: true });

  const tempDir = await mkdtemp(path.join(tmpdir(), "videobot-"));
  const framesDir = path.join(tempDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const fileName = `${options.sessionName}-${Date.now()}-${randomUUID().slice(0, 8)}.mp4`;
  const outputPath = path.join(renderingsDir, fileName);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const vw = options.videoWidth ?? options.width;
    const vh = options.videoHeight ?? options.height;
    const zoom = options.zoom ?? 1;

    const context = await browser.newContext({
      viewport: { width: Math.round(vw / zoom), height: Math.round(vh / zoom) },
      deviceScaleFactor: zoom,
    });
    const page = await context.newPage();

    const clock = await installVirtualTimeClock(page);
    await page.goto(options.url, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    // Advance 5s virtual time so page animations settle before capture begins.
    await clock.advance(10000);

    const totalDurationMs = await renderFrames(page, framesDir, options, clock);
    await encodeVideo(framesDir, outputPath, {
      ...options,
      durationMs: totalDurationMs,
    });

    void cleanupOldRenders(renderingsDir, RENDER_MAX_AGE_MS);

    return {
      videoUrl: `/users/${options.presenter}/${options.sessionName}/renderings/${fileName}`,
      outputPath,
      totalDurationMs,
    };
  } finally {
    await browser.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}
