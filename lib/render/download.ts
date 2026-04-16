import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { r2Client } from "@/lib/storage/r2";
import { GetObjectCommand } from "@aws-sdk/client-s3";

const BUCKET = process.env.S3_BUCKET!;

/**
 * Download a file from R2 to a local path.
 * Returns the absolute path on disk.
 */
async function downloadFromR2(key: string, destPath: string): Promise<void> {
  await mkdir(path.dirname(destPath), { recursive: true });

  const res = await r2Client.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key })
  );

  if (!res.Body) throw new Error(`Empty body for R2 key: ${key}`);

  const chunks: Uint8Array[] = [];
  // @ts-expect-error — Body is a ReadableStream in Node
  for await (const chunk of res.Body) {
    chunks.push(chunk as Uint8Array);
  }

  await writeFile(destPath, Buffer.concat(chunks));
}

export type DownloadedRecording = {
  mouseJsonPath: string;
  webcamPath: string | null;
  mouseData: {
    events: unknown[];
    virtualWidth: number;
    virtualHeight: number;
  };
};

/**
 * Download a recording's assets from R2 to a local working directory.
 *
 * `mouseEventsUrl` and `webcamUrl` are the R2 keys stored in vlad_recordings
 * (e.g. "recordings/{id}/mouse.json").
 */
export async function downloadRecording(
  mouseEventsUrl: string,
  webcamUrl: string | null,
  destDir: string,
): Promise<DownloadedRecording> {
  const mouseJsonPath = path.join(destDir, "mouse.json");
  await downloadFromR2(mouseEventsUrl, mouseJsonPath);

  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(mouseJsonPath, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  if (
    !Array.isArray(parsed.events) ||
    typeof parsed.virtualWidth !== "number" ||
    typeof parsed.virtualHeight !== "number"
  ) {
    throw new Error("Mouse recording is missing required fields (events, virtualWidth, virtualHeight).");
  }

  let webcamPath: string | null = null;
  if (webcamUrl) {
    webcamPath = path.join(destDir, "webcam.webm");
    await downloadFromR2(webcamUrl, webcamPath);
  }

  return {
    mouseJsonPath,
    webcamPath,
    mouseData: {
      events: parsed.events as unknown[],
      virtualWidth: parsed.virtualWidth,
      virtualHeight: parsed.virtualHeight,
    },
  };
}
