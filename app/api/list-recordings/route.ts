import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const SESSIONS_DIR = path.join(process.cwd(), "public", "sessions");

type RecordingEntry = {
  name: string;
  recordedAt: string;
};

export async function GET() {
  let entries: Dirent[];

  try {
    entries = await readdir(SESSIONS_DIR, { withFileTypes: true });
  } catch {
    return NextResponse.json({ recordings: [] });
  }

  const subdirs = entries.filter((e) => e.isDirectory());

  const recordings = (
    await Promise.all(
      subdirs.map(async (entry): Promise<RecordingEntry | null> => {
        const name = entry.name;
        const filePath = path.join(SESSIONS_DIR, name, "recordings", `${name}_mouse.json`);
        try {
          const raw = await readFile(filePath, "utf-8");
          const parsed = JSON.parse(raw) as { session?: string; recordedAt?: string };
          if (typeof parsed.session !== "string" || typeof parsed.recordedAt !== "string") {
            return null;
          }
          return { name: parsed.session, recordedAt: parsed.recordedAt };
        } catch {
          return null;
        }
      })
    )
  )
    .filter((r): r is RecordingEntry => r !== null)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

  return NextResponse.json({ recordings });
}
