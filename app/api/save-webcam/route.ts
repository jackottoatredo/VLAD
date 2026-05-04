import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { uploadToR2 } from "@/lib/storage/r2";
import { bakeAmplitudeForWebcam } from "@/lib/audio/amplitude";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const flowIdRaw = formData.get("flowId");
  const video = formData.get("video");

  const flowId = typeof flowIdRaw === "string" ? flowIdRaw.trim() : "";
  if (!UUID_RE.test(flowId)) {
    return NextResponse.json({ error: "Missing or invalid flowId." }, { status: 400 });
  }
  if (!(video instanceof Blob)) {
    return NextResponse.json({ error: "Missing video data." }, { status: 400 });
  }

  const buffer = Buffer.from(await video.arrayBuffer());
  const r2Key = `sessions/${session.email}/${flowId}/webcam.webm`;

  await uploadToR2(r2Key, buffer, "video/webm");

  // Pre-bake the amplitude track so the renderer's audio-mode throb is free at
  // render time. Best-effort — failures shouldn't block the upload response.
  void bakeAmplitudeForWebcam(r2Key).catch((err) => {
    console.error(`[save-webcam] amplitude bake failed for ${r2Key}:`, err);
  });

  return NextResponse.json({ ok: true, r2Key });
}
