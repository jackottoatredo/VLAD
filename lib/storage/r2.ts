import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BUCKET = process.env.S3_BUCKET!;

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
  expiresIn = 3600
): Promise<string> {
  return getSignedUrl(
    r2Client,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
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
