import { NextResponse } from "next/server";
import { requireSession, sanitizePresenter } from "@/lib/apiAuth";
import { uploadToR2 } from "@/lib/storage/r2";

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

  const safePresenter = sanitizePresenter(session.email);
  const buffer = Buffer.from(await video.arrayBuffer());
  const r2Key = `sessions/${safePresenter}/${flowId}/webcam.webm`;

  await uploadToR2(r2Key, buffer, "video/webm");

  return NextResponse.json({ ok: true, r2Key });
}
