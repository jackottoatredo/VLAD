import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const RECORDINGS_DIR = path.join(process.cwd(), "public", "recordings");

type RecordingEntry = {
  name: string;
  recordedAt: string;
};

export async function GET() {
  let entries: Awaited<ReturnType<typeof readdir>>;

  try {
    entries = await readdir(RECORDINGS_DIR, { withFileTypes: true });
  } catch {
    return NextResponse.json({ recordings: [] });
  }

  const jsonFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".json"));

  const recordings = (
    await Promise.all(
      jsonFiles.map(async (entry): Promise<RecordingEntry | null> => {
        try {
          const raw = await readFile(path.join(RECORDINGS_DIR, entry.name), "utf-8");
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
