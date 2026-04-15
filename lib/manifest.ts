import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ManifestRender = {
  url: string;
  path: string;
  publicUrl: string;
  durationMs: number;
  mouseJsonHash: string;
};

export type ManifestComposite = {
  path: string;
  publicUrl: string;
  trims: Record<string, { path: string; publicUrl: string }>;
};

export type ManifestUrlEntry = {
  render: ManifestRender;
  composites: Record<string, ManifestComposite>;
};

export type Manifest = {
  renders: Record<string, ManifestUrlEntry>;
};

export type CachedArtifacts = {
  startFromStep: 1 | 2 | 3;
  renderPath?: string;
  renderUrl?: string;
  renderDurationMs?: number;
  compositePath?: string;
  compositeUrl?: string;
  trimmedUrl?: string;
};

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const PUBLIC_DIR = path.join(process.cwd(), "public");

export function recordingDir(presenter: string, identifier: string): string {
  const dirName = `${presenter}_${identifier}`;
  return path.join(PUBLIC_DIR, "users", presenter, dirName);
}

export function renderingsDir(presenter: string, identifier: string): string {
  return path.join(recordingDir(presenter, identifier), "renderings");
}

function manifestPath(presenter: string, identifier: string): string {
  return path.join(renderingsDir(presenter, identifier), "manifest.json");
}

export function mouseJsonPath(presenter: string, identifier: string): string {
  const dirName = `${presenter}_${identifier}`;
  return path.join(recordingDir(presenter, identifier), "recordings", `${dirName}_mouse.json`);
}

// ---------------------------------------------------------------------------
// Hash helpers
// ---------------------------------------------------------------------------

export function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export function webcamFingerprint(settings: {
  webcamMode: string;
  webcamVertical: string;
  webcamHorizontal: string;
}): string {
  return `${settings.webcamMode}_${settings.webcamVertical}_${settings.webcamHorizontal}`;
}

export function trimKey(startSec: number | undefined, endSec: number | undefined): string {
  const s = (startSec ?? 0).toFixed(3);
  const e = (endSec ?? 0).toFixed(3);
  return `${s}_${e}`;
}

export async function hashMouseJson(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// Manifest read/write
// ---------------------------------------------------------------------------

export async function readManifest(presenter: string, identifier: string): Promise<Manifest> {
  const p = manifestPath(presenter, identifier);
  try {
    const raw = await readFile(p, "utf-8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return { renders: {} };
  }
}

export async function writeManifest(presenter: string, identifier: string, manifest: Manifest): Promise<void> {
  const dir = renderingsDir(presenter, identifier);
  await mkdir(dir, { recursive: true });
  await writeFile(manifestPath(presenter, identifier), JSON.stringify(manifest, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Cache lookup — determines which pipeline step to start from
// ---------------------------------------------------------------------------

export function findCachedArtifacts(
  manifest: Manifest,
  urlHash: string,
  mouseHash: string,
  wcFingerprint: string,
  tKey: string,
): CachedArtifacts {
  const entry = manifest.renders[urlHash];

  // No render for this URL, or mouse recording changed → full render
  if (!entry || entry.render.mouseJsonHash !== mouseHash || !existsSync(entry.render.path)) {
    return { startFromStep: 1 };
  }

  const composite = entry.composites[wcFingerprint];

  // Render exists but no composite for these webcam settings → recomposite
  if (!composite || !existsSync(composite.path)) {
    return {
      startFromStep: 2,
      renderPath: entry.render.path,
      renderUrl: entry.render.publicUrl,
      renderDurationMs: entry.render.durationMs,
    };
  }

  const trimmed = composite.trims[tKey];

  // Composite exists but no trim for these marks → retrim
  if (!trimmed || !existsSync(trimmed.path)) {
    return {
      startFromStep: 3,
      renderPath: entry.render.path,
      renderUrl: entry.render.publicUrl,
      renderDurationMs: entry.render.durationMs,
      compositePath: composite.path,
      compositeUrl: composite.publicUrl,
    };
  }

  // Fully cached — return the trimmed video URL directly
  return {
    startFromStep: 3, // won't actually run — caller checks trimmedUrl
    renderPath: entry.render.path,
    renderUrl: entry.render.publicUrl,
    renderDurationMs: entry.render.durationMs,
    compositePath: composite.path,
    compositeUrl: composite.publicUrl,
    trimmedUrl: trimmed.publicUrl,
  };
}

// ---------------------------------------------------------------------------
// Manifest update helpers
// ---------------------------------------------------------------------------

export function updateManifestFromResult(
  manifest: Manifest,
  urlHash: string,
  url: string,
  mouseHash: string,
  wcFingerprint: string,
  tKey: string,
  result: {
    renderUrl: string;
    renderPath: string;
    renderDurationMs: number;
    compositeUrl: string;
    compositePath: string;
    trimmedUrl: string | null;
  },
): Manifest {
  const updated = { ...manifest, renders: { ...manifest.renders } };

  // Ensure URL entry exists with fresh render data
  if (!updated.renders[urlHash] || updated.renders[urlHash].render.mouseJsonHash !== mouseHash) {
    updated.renders[urlHash] = {
      render: {
        url,
        path: result.renderPath,
        publicUrl: result.renderUrl,
        durationMs: result.renderDurationMs,
        mouseJsonHash: mouseHash,
      },
      composites: {},
    };
  }

  const entry = updated.renders[urlHash];

  // Update composite
  if (!entry.composites[wcFingerprint]) {
    entry.composites[wcFingerprint] = {
      path: result.compositePath,
      publicUrl: result.compositeUrl,
      trims: {},
    };
  } else {
    entry.composites[wcFingerprint].path = result.compositePath;
    entry.composites[wcFingerprint].publicUrl = result.compositeUrl;
  }

  // Update trim
  if (result.trimmedUrl) {
    const trimmedPath = path.join(PUBLIC_DIR, result.trimmedUrl);
    entry.composites[wcFingerprint].trims[tKey] = {
      path: trimmedPath,
      publicUrl: result.trimmedUrl,
    };
  }

  return updated;
}
