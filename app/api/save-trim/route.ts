import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const PUBLIC_DIR = path.join(process.cwd(), "public");

type RequestBody = {
  presenter?: unknown;
  session?: unknown;
  trimStartSec?: unknown;
  trimEndSec?: unknown;
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
  if (typeof body.trimStartSec !== "number" || typeof body.trimEndSec !== "number") {
    return NextResponse.json({ error: "Missing or invalid trim times." }, { status: 400 });
  }

  const safePresenter = body.presenter.replace(/[^a-z0-9_\-]/gi, "_");
  const safeName = body.session.replace(/[^a-z0-9_\-]/gi, "_");
  const metadataPath = path.join(
    PUBLIC_DIR, "users", safePresenter, safeName, "recordings", "metadata.json",
  );

  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(await readFile(metadataPath, "utf-8"));
  } catch {
    return NextResponse.json({ error: "Session metadata not found." }, { status: 404 });
  }

  metadata.trimStartSec = body.trimStartSec;
  metadata.trimEndSec = body.trimEndSec;

  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");

  return NextResponse.json({ ok: true });
}
