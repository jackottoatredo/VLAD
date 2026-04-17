import { NextResponse } from "next/server";
import { requireSession, sanitizePresenter } from "@/lib/apiAuth";
import { uploadToR2 } from "@/lib/storage/r2";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const record = body as Record<string, unknown>;

  if (typeof record.session !== "string" || !record.session.trim()) {
    return NextResponse.json({ error: "Missing session name." }, { status: 400 });
  }

  const safePresenter = sanitizePresenter(session.email);
  // session is dirName = `${presenter}_{safeId}` — extract safeId
  const safeName = record.session.replace(/[^a-z0-9_\-]/gi, "_");
  const safeId = safeName.startsWith(`${safePresenter}_`)
    ? safeName.slice(safePresenter.length + 1)
    : safeName;

  const payload = { ...record, presenter: session.email };
  const jsonBuffer = Buffer.from(JSON.stringify(payload, null, 2), "utf-8");
  const r2Key = `sessions/${safePresenter}/${safeId}/mouse.json`;

  await uploadToR2(r2Key, jsonBuffer, "application/json");

  return NextResponse.json({ ok: true, r2Key });
}
