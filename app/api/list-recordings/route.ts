import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const USERS_DIR = path.join(process.cwd(), "public", "users");
const PRESENTER_PATTERN = /^[a-zA-Z]+_[a-zA-Z]+$/;

type RecordingEntry = {
  name: string;
  presenter: string;
  recordedAt: string;
};

export async function GET() {
  let topEntries: Dirent[];

  try {
    topEntries = await readdir(USERS_DIR, { withFileTypes: true });
  } catch {
    return NextResponse.json({ recordings: [] });
  }

  const presenterDirs = topEntries.filter(
    (e) => e.isDirectory() && PRESENTER_PATTERN.test(e.name)
  );

  const perPresenter = await Promise.all(
    presenterDirs.map(async (presenterEntry) => {
      let sessionEntries: Dirent[];
      try {
        sessionEntries = await readdir(
          path.join(USERS_DIR, presenterEntry.name),
          { withFileTypes: true }
        );
      } catch {
        return [] as RecordingEntry[];
      }

      const sessions = await Promise.all(
        sessionEntries
          .filter((e) => e.isDirectory())
          .map(async (sessionEntry): Promise<RecordingEntry | null> => {
            const filePath = path.join(
              USERS_DIR,
              presenterEntry.name,
              sessionEntry.name,
              "recordings",
              `${sessionEntry.name}_mouse.json`
            );
            try {
              const raw = await readFile(filePath, "utf-8");
              const parsed = JSON.parse(raw) as { session?: string; recordedAt?: string };
              if (typeof parsed.session !== "string" || typeof parsed.recordedAt !== "string") {
                return null;
              }
              return {
                name: parsed.session,
                presenter: presenterEntry.name,
                recordedAt: parsed.recordedAt,
              };
            } catch {
              return null;
            }
          })
      );

      return sessions.filter((r): r is RecordingEntry => r !== null);
    })
  );

  const recordings = perPresenter
    .flat()
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

  return NextResponse.json({ recordings });
}
