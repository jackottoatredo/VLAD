import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const PUBLIC_DIR = path.join(process.cwd(), "public");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const presenter = searchParams.get("presenter");
  const session = searchParams.get("session");

  if (!presenter || !session) {
    return NextResponse.json({ error: "Missing presenter or session." }, { status: 400 });
  }

  const filePath = path.join(
    PUBLIC_DIR,
    "users",
    presenter,
    session,
    "recordings",
    "metadata.json"
  );

  try {
    const raw = await readFile(filePath, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "Metadata not found." }, { status: 404 });
  }
}
