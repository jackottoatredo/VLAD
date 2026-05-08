import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BUCKET = process.env.S3_BUCKET!;

// Top-level namespace for every VLAD-owned R2 key. The bucket is shared with
// other Redo apps (Shopify scrape data under harvest/, screenshots/, etc.) —
// VLAD writes everything under `vlad/` so ownership is unambiguous.
export const VLAD_NAMESPACE = "vlad";

/** Either a per-recording or per-render section type. Plain produce uses the
 *  recording's own type; product-only-export hardcodes "product"; merge-export
 *  populates both. */
export type RenderSection = "merchant" | "product";

/** Root R2 prefix for everything a single user owns. */
export function userDir(userId: string): string {
  return `${VLAD_NAMESPACE}/users/${userId}`;
}

/** Per-recording entity dir (canonical session data + preview). */
export function recordingDir(userId: string, recordingId: string): string {
  return `${userDir(userId)}/recordings/${recordingId}`;
}

/** Per-render entity dir (final video + share assets). */
export function renderDir(userId: string, renderId: string): string {
  return `${userDir(userId)}/renders/${renderId}`;
}

/** Per-job intermediate dir under a recording (plain produce / preview flow). */
export function recordingJobDir(userId: string, recordingId: string, jobId: string): string {
  return `${recordingDir(userId, recordingId)}/intermediates/${jobId}`;
}

/** Per-job intermediate dir under a render (product-only-export, merge-export). */
export function renderJobDir(userId: string, renderId: string, jobId: string): string {
  return `${renderDir(userId, renderId)}/intermediates/${jobId}`;
}

/** Section subdir under a job's intermediate dir (where bg.mp4 + overlay.mov live). */
export function sectionDir(jobDir: string, section: RenderSection): string {
  return `${jobDir}/${section}`;
}

export const r2Client = new S3Client({
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  await r2Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function getPresignedUrl(
  key: string,
  expiresIn = 3600,
  options?: { contentType?: string; contentDisposition?: string },
): Promise<string> {
  return getSignedUrl(
    r2Client,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentType: options?.contentType,
      ResponseContentDisposition: options?.contentDisposition,
    }),
    { expiresIn }
  );
}

/**
 * Download a file from R2 to a local path. Creates parent directories.
 */
export async function downloadFromR2(key: string, destPath: string): Promise<void> {
  await mkdir(path.dirname(destPath), { recursive: true });

  const res = await r2Client.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
  );

  if (!res.Body) throw new Error(`Empty body for R2 key: ${key}`);

  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk as Uint8Array);
  }

  await writeFile(destPath, Buffer.concat(chunks));
}

/**
 * Delete a single object from R2. Does not throw if the key does not exist.
 */
export async function deleteFromR2(key: string): Promise<void> {
  try {
    await r2Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    /* swallow */
  }
}

/**
 * Delete multiple objects from R2 in a single request.
 */
export async function deleteManyFromR2(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await r2Client.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: keys.map((k) => ({ Key: k })) },
      }),
    );
  } catch {
    /* swallow */
  }
}

/**
 * Delete every object under a prefix. Lists all matching keys (paginated)
 * then bulk-deletes them in batches of 1000. The single most useful primitive
 * for entity cleanup since the bucket is now organized so each entity owns a
 * single contiguous prefix.
 */
export async function deleteByPrefix(prefix: string): Promise<number> {
  const keys = await listKeysWithPrefix(prefix);
  if (keys.length === 0) return 0;
  const BATCH = 1000;
  for (let i = 0; i < keys.length; i += BATCH) {
    await deleteManyFromR2(keys.slice(i, i + BATCH));
  }
  return keys.length;
}

/**
 * Server-side copy from one R2 key to another. No data leaves R2 — Cloudflare
 * fans the bytes around internally — so this is cheap. Used by the worker to
 * promote a final intermediate (trim.mp4 / composite.mp4) to the entity's
 * canonical video path (renders/{id}/video.mp4 or recordings/{id}/preview.mp4)
 * after produce completes.
 */
export async function copyR2Object(srcKey: string, destKey: string): Promise<void> {
  await r2Client.send(
    new CopyObjectCommand({
      Bucket: BUCKET,
      Key: destKey,
      // CopySource encoding: bucket + URL-encoded key, with `/` preserved.
      CopySource: `/${BUCKET}/${encodeURIComponent(srcKey).replace(/%2F/g, "/")}`,
    }),
  );
}

/**
 * List every key under a prefix, paginating until the bucket is exhausted.
 * Returns just the keys — sizes/timestamps are dropped since callers that
 * need them can use ListObjectsV2 directly. Useful for cleanup paths that
 * need to find files an upstream session/render wrote (intermediates in
 * vlad/composites/, vlad/renders/, vlad/trims/) when those keys aren't
 * tracked in any DB column or cache entry.
 */
export async function listKeysWithPrefix(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await r2Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const o of res.Contents ?? []) {
      if (o.Key) out.push(o.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/**
 * Download a file from R2 and return its contents as a Buffer.
 */
export async function downloadBufferFromR2(key: string): Promise<Buffer> {
  const res = await r2Client.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
  );

  if (!res.Body) throw new Error(`Empty body for R2 key: ${key}`);

  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk as Uint8Array);
  }

  return Buffer.concat(chunks);
}
