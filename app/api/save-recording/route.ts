import { NextResponse } from "next/server";
import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const PUBLIC_DIR = path.join(process.cwd(), "public");

type RequestBody = {
  presenter?: unknown;
  session?: unknown;
  name?: unknown;
};

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (typeof body.presenter !== "string" || !body.presenter.trim()) {
    return NextResponse.json({ error: "Missing presenter." }, { status: 400 });
  }
  if (typeof body.session !== "string" || !body.session.trim()) {
    return NextResponse.json({ error: "Missing session." }, { status: 400 });
  }
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Missing name." }, { status: 400 });
  }

  const safePresenter = body.presenter.replace(/[^a-z0-9_\-]/gi, "_");
  const safeName = body.session.replace(/[^a-z0-9_\-]/gi, "_");
  const saveName = body.name.trim().replace(/[^a-z0-9_\- ]/gi, "_");

  const sourceDir = path.join(PUBLIC_DIR, "users", safePresenter, safeName);
  if (!existsSync(sourceDir)) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const destDir = path.join(PUBLIC_DIR, "saved", saveName);
  if (existsSync(destDir)) {
    return NextResponse.json({ error: "A recording with that name already exists." }, { status: 409 });
  }

  await mkdir(path.dirname(destDir), { recursive: true });
  await cp(sourceDir, destDir, { recursive: true });

  return NextResponse.json({ ok: true, path: `/saved/${saveName}` });
}
