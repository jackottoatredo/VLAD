import { NextResponse } from "next/server";
import { readdir } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const USERS_DIR = path.join(process.cwd(), "public", "users");
const PRESENTER_PATTERN = /^[a-zA-Z]+_[a-zA-Z]+$/;

export async function GET() {
  try {
    const entries = await readdir(USERS_DIR, { withFileTypes: true });
    const users = entries
      .filter((e) => e.isDirectory() && PRESENTER_PATTERN.test(e.name))
      .map((e) => e.name)
      .sort();
    return NextResponse.json({ users });
  } catch {
    return NextResponse.json({ users: [] });
  }
}
