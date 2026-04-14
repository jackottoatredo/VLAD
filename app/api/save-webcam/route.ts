import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const PUBLIC_DIR = path.join(process.cwd(), "public");

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const session = formData.get("session");
  const presenter = formData.get("presenter");
  const video = formData.get("video");

  if (typeof session !== "string" || !session.trim()) {
    return NextResponse.json({ error: "Missing session name." }, { status: 400 });
  }
  if (typeof presenter !== "string" || !presenter.trim()) {
    return NextResponse.json({ error: "Missing presenter." }, { status: 400 });
  }
  if (!(video instanceof Blob)) {
    return NextResponse.json({ error: "Missing video data." }, { status: 400 });
  }

  const product = formData.get("product");
  const startedAt = formData.get("startedAt");
  const width = Number(formData.get("width") ?? 0);
  const height = Number(formData.get("height") ?? 0);
  const webcamMode = (formData.get("webcamMode") as string) ?? "video";
  const webcamVertical = (formData.get("webcamVertical") as string) ?? "bottom";
  const webcamHorizontal = (formData.get("webcamHorizontal") as string) ?? "right";
  const merchantUrl = formData.get("merchantUrl") as string | null;

  const safeName = session.replace(/[^a-z0-9_\-]/gi, "_");
  const safePresenter = presenter.replace(/[^a-z0-9_\-]/gi, "_");
  const recordingsDir = path.join(PUBLIC_DIR, "users", safePresenter, safeName, "recordings");

  await mkdir(recordingsDir, { recursive: true });

  const buffer = Buffer.from(await video.arrayBuffer());
  await writeFile(path.join(recordingsDir, `${safeName}_webcam.webm`), buffer);

  await writeFile(
    path.join(recordingsDir, "metadata.json"),
    JSON.stringify({ product, merchantUrl, width, height, startedAt, webcamMode, webcamVertical, webcamHorizontal }, null, 2),
    "utf-8"
  );

  return NextResponse.json({ ok: true, path: `/users/${safePresenter}/${safeName}/recordings/${safeName}_webcam.webm` });
}
