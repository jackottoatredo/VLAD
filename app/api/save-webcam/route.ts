import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireSession, sanitizePresenter } from "@/lib/apiAuth";

export const runtime = "nodejs";

const PUBLIC_DIR = path.join(process.cwd(), "public");

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

  const safeName = sessionName.replace(/[^a-z0-9_\-]/gi, "_");
  const safePresenter = sanitizePresenter(session.email);
  const recordingsDir = path.join(PUBLIC_DIR, "users", safePresenter, safeName, "recordings");

  await mkdir(recordingsDir, { recursive: true });

  const buffer = Buffer.from(await video.arrayBuffer());
  await writeFile(path.join(recordingsDir, `${safeName}_webcam.webm`), buffer);

  return NextResponse.json({ ok: true, path: `/users/${safePresenter}/${safeName}/recordings/${safeName}_webcam.webm` });
}
