import { NextResponse } from "next/server";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const USERS_DIR = path.join(process.cwd(), "public", "users");
const NAME_PART = /^[a-zA-Z]+$/;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { firstName, lastName } = body as Record<string, unknown>;

  if (typeof firstName !== "string" || !NAME_PART.test(firstName)) {
    return NextResponse.json({ error: "Invalid first name." }, { status: 400 });
  }
  if (typeof lastName !== "string" || !NAME_PART.test(lastName)) {
    return NextResponse.json({ error: "Invalid last name." }, { status: 400 });
  }

  const userId = `${lastName.toLowerCase()}_${firstName.toLowerCase()}`;
  await mkdir(path.join(USERS_DIR, userId), { recursive: true });

  return NextResponse.json({ ok: true, userId });
}
