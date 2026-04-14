import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/db/supabase";
import { uploadToR2 } from "@/lib/storage/r2";

export const runtime = "nodejs";

const PUBLIC_DIR = path.join(process.cwd(), "public");

type RequestBody = {
  presenter?: unknown;
  session?: unknown;
  type?: unknown;
  productName?: unknown;
  merchantId?: unknown;
};

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (typeof body.presenter !== "string" || !body.presenter.trim()) {
    return NextResponse.json({ error: "Missing presenter." }, { status: 400 });
  }
  if (typeof body.session !== "string" || !body.session.trim()) {
    return NextResponse.json({ error: "Missing session." }, { status: 400 });
  }
  if (body.type !== "product" && body.type !== "merchant") {
    return NextResponse.json({ error: "Invalid type. Must be 'product' or 'merchant'." }, { status: 400 });
  }

  const safePresenter = body.presenter.replace(/[^a-z0-9_\-]/gi, "_");
  const safeSession = body.session.replace(/[^a-z0-9_\-]/gi, "_");
  const recordingsDir = path.join(PUBLIC_DIR, "users", safePresenter, safeSession, "recordings");

  const mouseJsonPath = path.join(recordingsDir, `${safeSession}_mouse.json`);
  if (!existsSync(mouseJsonPath)) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const recordingId = randomUUID();

  // Read local draft files
  const mouseBuffer = await readFile(mouseJsonPath);
  const metadataPath = path.join(recordingsDir, "metadata.json");
  const metadataRaw = existsSync(metadataPath) ? await readFile(metadataPath, "utf-8") : "{}";
  const metadata = JSON.parse(metadataRaw);

  const webcamPath = path.join(recordingsDir, `${safeSession}_webcam.webm`);
  const hasWebcam = existsSync(webcamPath);
  const webcamBuffer = hasWebcam ? await readFile(webcamPath) : null;

  // Upload to R2 in parallel
  const uploads: Promise<void>[] = [
    uploadToR2(`recordings/${recordingId}/mouse.json`, mouseBuffer, "application/json"),
  ];
  if (webcamBuffer) {
    uploads.push(
      uploadToR2(`recordings/${recordingId}/webcam.webm`, webcamBuffer, "video/webm")
    );
  }
  await Promise.all(uploads);

  // Insert into Supabase
  const { error } = await supabase.from("vlad_recordings").insert({
    id: recordingId,
    user_id: safePresenter,
    type: body.type,
    product_name: body.type === "product" && typeof body.productName === "string" ? body.productName : null,
    merchant_id: body.type === "merchant" && typeof body.merchantId === "string" ? body.merchantId : null,
    mouse_events_url: `recordings/${recordingId}/mouse.json`,
    webcam_url: hasWebcam ? `recordings/${recordingId}/webcam.webm` : null,
    metadata,
    status: "saved",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, recordingId });
}
