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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const flowId = typeof record.flowId === "string" ? record.flowId.trim() : "";

  if (!UUID_RE.test(flowId)) {
    return NextResponse.json({ error: "Missing or invalid flowId." }, { status: 400 });
  }

  const safePresenter = sanitizePresenter(session.email);
  const payload = { ...record, presenter: session.email, flowId };
  const jsonBuffer = Buffer.from(JSON.stringify(payload, null, 2), "utf-8");
  const r2Key = `sessions/${safePresenter}/${flowId}/mouse.json`;

  await uploadToR2(r2Key, jsonBuffer, "application/json");

  return NextResponse.json({ ok: true, r2Key });
}
