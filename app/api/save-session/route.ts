import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const PUBLIC_DIR = path.join(process.cwd(), "public");

export async function POST(request: Request) {
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
  if (typeof record.presenter !== "string" || !record.presenter.trim()) {
    return NextResponse.json({ error: "Missing presenter." }, { status: 400 });
  }

  const safeName = record.session.replace(/[^a-z0-9_\-]/gi, "_");
  const safePresenter = record.presenter.replace(/[^a-z0-9_\-]/gi, "_");
  const recordingsDir = path.join(PUBLIC_DIR, "users", safePresenter, safeName, "recordings");
  const filePath = path.join(recordingsDir, `${safeName}_mouse.json`);

  await mkdir(recordingsDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(record, null, 2), "utf-8");

  return NextResponse.json({ ok: true, path: `/users/${safePresenter}/${safeName}/recordings/${safeName}_mouse.json` });
}
