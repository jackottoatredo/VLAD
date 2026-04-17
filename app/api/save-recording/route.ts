import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/db/supabase";
import { uploadToR2, downloadBufferFromR2 } from "@/lib/storage/r2";
import { requireSession, sanitizePresenter } from "@/lib/apiAuth";

export const runtime = "nodejs";

type RequestBody = {
  session?: unknown;
  type?: unknown;
  productName?: unknown;
  merchantId?: unknown;
  metadata?: unknown;
  /** R2 key of the rendered preview video (e.g. composites/presenter/session/file.mp4) */
  previewVideoR2Key?: unknown;
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
  const safeId = safeSession.startsWith(`${safePresenter}_`)
    ? safeSession.slice(safePresenter.length + 1)
    : safeSession;

  // Read mouse events from R2 (uploaded by save-session)
  const mouseR2Key = `sessions/${safePresenter}/${safeId}/mouse.json`;
  let mouseBuffer: Buffer;
  try {
    mouseBuffer = await downloadBufferFromR2(mouseR2Key);
  } catch {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const recordingId = randomUUID();

  // Check if webcam exists in R2
  const webcamSessionKey = `sessions/${safePresenter}/${safeId}/webcam.webm`;
  let webcamBuffer: Buffer | null = null;
  try {
    webcamBuffer = await downloadBufferFromR2(webcamSessionKey);
  } catch {
    // No webcam recorded — that's fine
  }

  const metadata = body.metadata != null && typeof body.metadata === "object" ? body.metadata : {};

  // Upload to permanent recording storage in R2
  const uploads: Promise<void>[] = [
    uploadToR2(`recordings/${recordingId}/mouse.json`, mouseBuffer, "application/json"),
  ];
  if (webcamBuffer) {
    uploads.push(
      uploadToR2(`recordings/${recordingId}/webcam.webm`, webcamBuffer, "video/webm"),
    );
  }

  // Copy preview video to permanent storage if provided
  let previewKey: string | null = null;
  if (typeof body.previewVideoR2Key === "string" && body.previewVideoR2Key.trim()) {
    try {
      const previewBuffer = await downloadBufferFromR2(body.previewVideoR2Key);
      previewKey = `recordings/${recordingId}/preview.mp4`;
      uploads.push(uploadToR2(previewKey, previewBuffer, "video/mp4"));
    } catch {
      // Preview not available — not critical
    }
  }

  await Promise.all(uploads);

  const { error } = await supabase.from("vlad_recordings").insert({
    id: recordingId,
    user_id: session.email,
    type: body.type,
    product_name: body.type === "product" && typeof body.productName === "string" ? body.productName : null,
    merchant_id: body.type === "merchant" && typeof body.merchantId === "string" ? body.merchantId : null,
    mouse_events_url: `recordings/${recordingId}/mouse.json`,
    webcam_url: webcamBuffer ? `recordings/${recordingId}/webcam.webm` : null,
    preview_url: previewKey,
    metadata,
    status: "saved",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, recordingId });
}
