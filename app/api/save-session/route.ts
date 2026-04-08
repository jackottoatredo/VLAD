import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const SESSIONS_DIR = path.join(process.cwd(), "public", "sessions");

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).session !== "string") {
    return NextResponse.json({ error: "Missing session name." }, { status: 400 });
  }

  const { session, ...rest } = body as Record<string, unknown>;
  const safeName = (session as string).replace(/[^a-z0-9_\-]/gi, "_");
  const sessionRecordingsDir = path.join(SESSIONS_DIR, safeName, "recordings");
  const filePath = path.join(sessionRecordingsDir, `${safeName}_mouse.json`);

  await mkdir(sessionRecordingsDir, { recursive: true });
  await writeFile(filePath, JSON.stringify({ session, ...rest }, null, 2), "utf-8");

  return NextResponse.json({ ok: true, path: `/sessions/${safeName}/recordings/${safeName}_mouse.json` });
}
