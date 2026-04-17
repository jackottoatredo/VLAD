import { NextResponse } from "next/server";
import { requireSession, sanitizePresenter } from "@/lib/apiAuth";
import { uploadToR2 } from "@/lib/storage/r2";

export const runtime = "nodejs";

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

  const sessionName = formData.get("session");
  const video = formData.get("video");

  if (typeof sessionName !== "string" || !sessionName.trim()) {
    return NextResponse.json({ error: "Missing session name." }, { status: 400 });
  }
  if (!(video instanceof Blob)) {
    return NextResponse.json({ error: "Missing video data." }, { status: 400 });
  }

  const safePresenter = sanitizePresenter(session.email);
  const safeName = sessionName.replace(/[^a-z0-9_\-]/gi, "_");
  const safeId = safeName.startsWith(`${safePresenter}_`)
    ? safeName.slice(safePresenter.length + 1)
    : safeName;

  const buffer = Buffer.from(await video.arrayBuffer());
  const r2Key = `sessions/${safePresenter}/${safeId}/webcam.webm`;

  await uploadToR2(r2Key, buffer, "video/webm");

  return NextResponse.json({ ok: true, r2Key });
}
