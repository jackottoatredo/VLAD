import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/db/supabase";
import { uploadToR2 } from "@/lib/storage/r2";
import { requireSession, sanitizePresenter } from "@/lib/apiAuth";

export const runtime = "nodejs";

const PUBLIC_DIR = path.join(process.cwd(), "public");

type RequestBody = {
  session?: unknown;
  type?: unknown;
  productName?: unknown;
  merchantId?: unknown;
  metadata?: unknown;
  /** Relative URL of the rendered preview video (e.g. /users/presenter/session/renderings/file.mp4) */
  previewVideoUrl?: unknown;
};

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (typeof body.session !== "string" || !body.session.trim()) {
    return NextResponse.json({ error: "Missing session." }, { status: 400 });
  }
  if (body.type !== "product" && body.type !== "merchant") {
    return NextResponse.json({ error: "Invalid type. Must be 'product' or 'merchant'." }, { status: 400 });
  }

  const safePresenter = sanitizePresenter(session.email);
  const safeSession = body.session.replace(/[^a-z0-9_\-]/gi, "_");
  const recordingsDir = path.join(PUBLIC_DIR, "users", safePresenter, safeSession, "recordings");

  const mouseJsonPath = path.join(recordingsDir, `${safeSession}_mouse.json`);
  if (!existsSync(mouseJsonPath)) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const recordingId = randomUUID();

  const mouseBuffer = await readFile(mouseJsonPath);

  const webcamPath = path.join(recordingsDir, `${safeSession}_webcam.webm`);
  const hasWebcam = existsSync(webcamPath);
  const webcamBuffer = hasWebcam ? await readFile(webcamPath) : null;

  const metadata = body.metadata != null && typeof body.metadata === "object" ? body.metadata : {};

  const uploads: Promise<void>[] = [
    uploadToR2(`recordings/${recordingId}/mouse.json`, mouseBuffer, "application/json"),
  ];
  if (webcamBuffer) {
    uploads.push(
      uploadToR2(`recordings/${recordingId}/webcam.webm`, webcamBuffer, "video/webm")
    );
  }

  // Upload preview video if provided
  let previewKey: string | null = null;
  if (typeof body.previewVideoUrl === "string" && body.previewVideoUrl.trim()) {
    const previewPath = path.join(PUBLIC_DIR, body.previewVideoUrl);
    if (existsSync(previewPath)) {
      const previewBuffer = await readFile(previewPath);
      previewKey = `recordings/${recordingId}/preview.mp4`;
      uploads.push(uploadToR2(previewKey, previewBuffer, "video/mp4"));
    }
  }

  await Promise.all(uploads);

  // Use raw email as user_id (matches vlad_users.id)
  const { error } = await supabase.from("vlad_recordings").insert({
    id: recordingId,
    user_id: session.email,
    type: body.type,
    product_name: body.type === "product" && typeof body.productName === "string" ? body.productName : null,
    merchant_id: body.type === "merchant" && typeof body.merchantId === "string" ? body.merchantId : null,
    mouse_events_url: `recordings/${recordingId}/mouse.json`,
    webcam_url: hasWebcam ? `recordings/${recordingId}/webcam.webm` : null,
    preview_url: previewKey,
    metadata,
    status: "saved",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, recordingId });
}
