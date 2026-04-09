import { NextResponse } from "next/server";
import { recordUrlToMp4 } from "@/lib/recording/record";

export const runtime = "nodejs";
export const maxDuration = 60;

type RecordRequestBody = {
  url?: unknown;
  width?: unknown;
  height?: unknown;
  fps?: unknown;
  durationMs?: unknown;
};

function toBoundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function parseHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: RecordRequestBody;

  try {
    body = (await request.json()) as RecordRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const url = parseHttpUrl(body.url);

  if (!url) {
    return NextResponse.json(
      { error: "Please provide a valid http/https URL." },
      { status: 400 }
    );
  }

  const width = toBoundedNumber(body.width, 1280, 320, 3840);
  const height = toBoundedNumber(body.height, 720, 240, 2160);
  const fps = toBoundedNumber(body.fps, 30, 1, 60);
  const durationMs = 1000;

  try {
    const result = await recordUrlToMp4({
      url,
      width,
      height,
      fps,
      durationMs,
    });

    return NextResponse.json({
      ok: true,
      videoUrl: result.videoUrl,
      width,
      height,
      fps,
      durationMs,
      totalDurationMs: result.totalDurationMs,
    });
  } catch (error) {
    console.error("Recording failed", error);

    return NextResponse.json(
      { error: "Recording failed. Check server logs for details." },
      { status: 500 }
    );
  }
}
