import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const SESSIONS_DIR = path.join(process.cwd(), "public", "sessions");

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const session = formData.get("session");
  const video = formData.get("video");

  if (typeof session !== "string" || !session.trim()) {
    return NextResponse.json({ error: "Missing session name." }, { status: 400 });
  }
  if (!(video instanceof Blob)) {
    return NextResponse.json({ error: "Missing video data." }, { status: 400 });
  }

  const safeName = session.replace(/[^a-z0-9_\-]/gi, "_");
  const sessionRecordingsDir = path.join(SESSIONS_DIR, safeName, "recordings");
  const filePath = path.join(sessionRecordingsDir, `${safeName}_webcam.webm`);

  await mkdir(sessionRecordingsDir, { recursive: true });
  const buffer = Buffer.from(await video.arrayBuffer());
  await writeFile(filePath, buffer);

  return NextResponse.json({ ok: true, path: `/sessions/${safeName}/recordings/${safeName}_webcam.webm` });
}
