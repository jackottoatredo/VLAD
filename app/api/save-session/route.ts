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

  const safeName = record.session.replace(/[^a-z0-9_\-]/gi, "_");
  const safePresenter = sanitizePresenter(session.email);
  const recordingsDir = path.join(PUBLIC_DIR, "users", safePresenter, safeName, "recordings");
  const filePath = path.join(recordingsDir, `${safeName}_mouse.json`);

  await mkdir(recordingsDir, { recursive: true });

  // Store the email as presenter in the JSON for reference
  const payload = { ...record, presenter: session.email };
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");

  return NextResponse.json({ ok: true, path: `/users/${safePresenter}/${safeName}/recordings/${safeName}_mouse.json` });
}
